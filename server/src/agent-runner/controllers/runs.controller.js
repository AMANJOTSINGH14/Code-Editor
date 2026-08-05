const mongoose = require("mongoose");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const { createAndEnqueue, listRuns, getRun } = require("../services/run.service");
const { streamRun } = require("../stream/sse");
const artifacts = require("../artifacts");
const AgentTask = require("../models/AgentTask");
const { executeSnippet, supportedLanguages } = require("../services/execute.service");
const { verifyAndFix } = require("../services/verify-fix.service");

/**
 * Webhook trigger. Signature already verified by the HMAC middleware.
 *
 * Answers 202 as soon as the run row exists and the job is queued; the agent
 * loop can take tens of seconds and the caller must never wait on it.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const triggerWebhook = asyncHandler(async (req, res) => {
  const { run, replayed } = await createAndEnqueue({
    taskRef: req.params.taskId,
    triggerSource: "webhook",
    idempotencyKey: req.webhook.idempotencyKey
  });

  // 202 for a new run, 200 for a replay — a replay is a successful no-op, not a
  // newly accepted unit of work.
  res.status(replayed ? 200 : 202).json({
    success: true,
    data: {
      runId: run._id.toString(),
      status: run.status,
      replayed
    }
  });
});

/**
 * Manual trigger from the UI.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const createRun = asyncHandler(async (req, res) => {
  const taskRef = req.body.taskId || req.body.slug;
  if (!taskRef) {
    throw new AppError("Missing taskId", 400, "INVALID_REQUEST");
  }

  const { run } = await createAndEnqueue({
    taskRef,
    triggerSource: "manual",
    triggeredBy: req.user.id
  });

  res.status(202).json({
    success: true,
    data: {
      runId: run._id.toString(),
      status: run.status
    }
  });
});

/**
 * List recent runs.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const list = asyncHandler(async (req, res) => {
  const runs = await listRuns({
    limit: Number(req.query.limit) || 50,
    taskId: req.query.taskId || null
  });

  res.status(200).json({
    success: true,
    data: { runs }
  });
});

/**
 * Fetch a single run with its full attempt history.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const get = asyncHandler(async (req, res) => {
  const run = await getRun(req.params.id);
  res.status(200).json({
    success: true,
    data: { run }
  });
});

/**
 * List available tasks, so the UI can offer them in the trigger control.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const listTasks = asyncHandler(async (req, res) => {
  const tasks = await AgentTask.find({}).sort({ createdAt: 1 });
  res.status(200).json({
    success: true,
    data: { tasks: tasks.map((task) => task.toMeta()) }
  });
});

/**
 * Stream a run's progress over SSE.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const stream = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError("Run not found", 404, "NOT_FOUND");
  }
  await streamRun(req.params.id, res);
});

/**
 * Download one artifact produced by a run.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const downloadArtifact = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new AppError("Run not found", 404, "NOT_FOUND");
  }

  const resolved = artifacts.resolveArtifactPath(req.params.id, req.params.name);
  if (!resolved) {
    throw new AppError("Artifact not found", 404, "NOT_FOUND");
  }

  // Attachment, and a content type that is never rendered: artifact bytes are
  // model-generated and must not be interpreted as HTML in the user's origin.
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${resolved.name}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(resolved.path);
});

/**
 * Run an arbitrary snippet the user typed, in the sandbox.
 *
 * Synchronous on purpose, unlike agent runs: the caller is a person staring at
 * an editor waiting for output, and the work is bounded by the same 30s
 * wall-clock the sandbox already enforces. Queueing it would add latency and a
 * polling UI for no benefit.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const executeCode = asyncHandler(async (req, res) => {
  const { code, language } = req.body || {};

  const result = await executeSnippet({
    code,
    language: language || "javascript",
    userId: req.user.id
  });

  res.status(200).json({ success: true, data: result });
});

/**
 * Report which languages this deployment can execute.
 *
 * The UI asks so it can disable the Run button with a real reason rather than
 * letting the user click and get a 400.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {void}
 */
const runtimes = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: { languages: supportedLanguages() } });
});

/**
 * Find a provable bug in the user's code and fix it, streaming progress.
 *
 * Streamed rather than a plain JSON reply because the loop takes 10-40s and
 * does several distinct things — a spinner with no detail for that long reads
 * as a hang. Reuses the same SSE shape as the rest of the subsystem.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const verifyFix = asyncHandler(async (req, res) => {
  const { code, language } = req.body || {};

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  const write = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await verifyAndFix({
      code,
      language: language || "javascript",
      userId: req.user.id,
      onEvent: write
    });
    write("result", result);
  } catch (error) {
    write("error", {
      message: error.message || "Verification failed",
      code: error.code || "VERIFY_FAILED"
    });
  } finally {
    if (!closed) res.end();
  }
});

module.exports = {
  triggerWebhook,
  createRun,
  list,
  get,
  listTasks,
  stream,
  downloadArtifact,
  executeCode,
  runtimes,
  verifyFix
};
