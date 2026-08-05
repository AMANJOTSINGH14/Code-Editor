const mongoose = require("mongoose");
const AgentRun = require("../models/AgentRun");
const AgentTask = require("../models/AgentTask");
const AppError = require("../../utils/AppError");
const logger = require("../../utils/logger");
const { enqueueRun } = require("../queue/queue");
const idempotency = require("./idempotency");

/**
 * Resolve a task by ObjectId or slug.
 *
 * The webhook path takes whatever is in the URL, and the demo script is far more
 * readable firing at `/trigger/self-correction-csv` than at a 24-character hex
 * id, so both forms resolve here.
 * @param {string} taskRef - Task id or slug.
 * @returns {Promise<import("mongoose").Document>} The task.
 * @throws {AppError} When not found or disabled.
 */
async function resolveTask(taskRef) {
  const query = mongoose.isValidObjectId(taskRef)
    ? { $or: [{ _id: taskRef }, { slug: taskRef }] }
    : { slug: taskRef };

  const task = await AgentTask.findOne(query);
  if (!task) {
    throw new AppError(`Agent task not found: ${taskRef}`, 404, "NOT_FOUND");
  }
  if (!task.enabled) {
    throw new AppError(`Agent task is disabled: ${taskRef}`, 409, "TASK_DISABLED");
  }
  return task;
}

/**
 * Create a run and enqueue it.
 *
 * Returns immediately after enqueuing — execution never blocks the caller, so
 * the webhook can answer 202 within milliseconds regardless of how long the
 * agent loop takes.
 * @param {Object} options - Trigger options.
 * @param {string} options.taskRef - Task id or slug.
 * @param {string} options.triggerSource - webhook | manual | cron.
 * @param {string} [options.triggeredBy] - User id for manual runs.
 * @param {string} [options.idempotencyKey] - Webhook idempotency key.
 * @returns {Promise<{run: Object, replayed: boolean}>} The run and whether it was a replay.
 */
async function createAndEnqueue({ taskRef, triggerSource, triggeredBy = null, idempotencyKey = null }) {
  const task = await resolveTask(taskRef);

  if (idempotencyKey) {
    const claimResult = await idempotency.claim(idempotencyKey);
    if (!claimResult.claimed) {
      // A replay. Answer with the original run rather than starting a second one.
      const existing = claimResult.runId
        ? await AgentRun.findById(claimResult.runId).catch(() => null)
        : await AgentRun.findOne({ idempotencyKey });

      if (existing) {
        logger.info({
          message: "Agent run replay ignored",
          runId: existing._id.toString(),
          idempotencyKey
        });
        return { run: existing, replayed: true };
      }

      // Claimed but the run row is not visible yet — a delivery is mid-flight.
      // Reporting it as a replay is correct: we must not start a second run.
      if (claimResult.pending) {
        throw new AppError(
          "A run for this delivery is already being created",
          409,
          "DUPLICATE_DELIVERY"
        );
      }
    }
  }

  let run;
  try {
    run = await AgentRun.create({
      taskId: task._id,
      triggerSource,
      triggeredBy,
      status: "queued",
      idempotencyKey
    });
  } catch (error) {
    // The unique partial index fired: two deliveries raced past the Redis claim.
    // The other one won; return its run.
    if (error && error.code === 11000 && idempotencyKey) {
      const existing = await AgentRun.findOne({ idempotencyKey });
      if (existing) {
        logger.info({
          message: "Agent run replay caught by unique index",
          runId: existing._id.toString(),
          idempotencyKey
        });
        return { run: existing, replayed: true };
      }
    }
    if (idempotencyKey) await idempotency.release(idempotencyKey);
    throw error;
  }

  const runId = run._id.toString();

  try {
    const jobId = await enqueueRun({
      runId,
      taskId: task._id.toString(),
      triggerSource
    });

    if (!jobId) {
      // Redis is unavailable, so nothing will ever pick this up. Mark it failed
      // now rather than leaving a run stuck in "queued" forever.
      run.status = "failed";
      run.error = { message: "Queue unavailable (Redis not configured)", code: "QUEUE_UNAVAILABLE" };
      run.finishedAt = new Date();
      await run.save();
      throw new AppError("Run queue unavailable", 503, "QUEUE_UNAVAILABLE");
    }
  } catch (error) {
    if (idempotencyKey) await idempotency.release(idempotencyKey);
    throw error;
  }

  if (idempotencyKey) await idempotency.record(idempotencyKey, runId);

  return { run, replayed: false };
}

/**
 * List runs, newest first.
 * @param {Object} options - Query options.
 * @param {number} [options.limit] - Max rows.
 * @param {string} [options.taskId] - Optional task filter.
 * @returns {Promise<Object[]>} Run summaries.
 */
async function listRuns({ limit = 50, taskId = null } = {}) {
  const filter = taskId ? { taskId } : {};
  // Attempt bodies are large; the list view never needs them.
  const runs = await AgentRun.find(filter)
    .select("-attempts.generatedCode -attempts.stdout -attempts.stderr")
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200));
  return runs.map((run) => run.toSummary());
}

/**
 * Fetch one run with full attempt history.
 * @param {string} runId - Run id.
 * @returns {Promise<Object>} Run detail.
 * @throws {AppError} When not found.
 */
async function getRun(runId) {
  if (!mongoose.isValidObjectId(runId)) {
    throw new AppError("Run not found", 404, "NOT_FOUND");
  }
  const run = await AgentRun.findById(runId);
  if (!run) {
    throw new AppError("Run not found", 404, "NOT_FOUND");
  }
  return run.toDetail();
}

module.exports = {
  createAndEnqueue,
  listRuns,
  getRun,
  resolveTask
};
