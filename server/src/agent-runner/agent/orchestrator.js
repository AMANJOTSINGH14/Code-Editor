const config = require("../config");
const logger = require("../../utils/logger");
const AgentRun = require("../models/AgentRun");
const AgentTask = require("../models/AgentTask");
const executor = require("../sandbox/executor");
const geminiClient = require("./gemini.client");
const prompts = require("./prompts");
const validator = require("./validator");
const { createRunBudget, BudgetExceededError, DailyCapExceededError } = require("../quota/budget");
const { ModelUnavailableError } = require("./gemini.client");
const pubsub = require("../stream/pubsub");
const artifacts = require("../artifacts");
const demoCache = require("../demo/cache");

/**
 * The agent loop.
 *
 * task spec -> generate plan + code -> execute in the sandbox -> if it failed,
 * feed the REAL stderr and exit code back and ask for a correction -> retry,
 * bounded by attempts, per-run call budget, and the global daily cap.
 *
 * Plan and code come back in ONE call rather than two. At 3 attempts that is 3
 * calls against a budget of 6, leaving genuine headroom; a separate planning
 * call would double consumption for no benefit the execution result does not
 * already provide.
 */

/**
 * Update run status and announce it.
 * @param {import("mongoose").Document} run - The run.
 * @param {string} status - New status.
 * @returns {Promise<void>} Resolves when saved.
 */
async function setStatus(run, status) {
  run.status = status;
  await AgentRun.updateOne({ _id: run._id }, { $set: { status } });
  pubsub.publish(run._id.toString(), "status", { status });
}

/**
 * Emit a log line to any live viewers.
 * @param {string} runId - Run id.
 * @param {string} message - Log text.
 * @param {string} [level] - Log level.
 * @returns {void}
 */
function emitLog(runId, message, level = "info") {
  pubsub.publish(runId, "log", { message, level });
}

/**
 * Append a new attempt record.
 *
 * $push, never overwrite. The attempt-by-attempt history IS the artifact that
 * demonstrates self-correction — replacing attempt N when attempt N+1 succeeds
 * would destroy the only evidence that any correction happened.
 * @param {string} runId - Run id.
 * @param {Object} attempt - Attempt document.
 * @returns {Promise<void>} Resolves when appended.
 */
async function appendAttempt(runId, attempt) {
  await AgentRun.updateOne({ _id: runId }, { $push: { attempts: attempt } });
}

/**
 * Patch the most recent attempt in place, by index.
 * @param {string} runId - Run id.
 * @param {number} index - Attempt index.
 * @param {Object} fields - Fields to set.
 * @returns {Promise<void>} Resolves when patched.
 */
async function patchAttempt(runId, index, fields) {
  const update = {};
  Object.entries(fields).forEach(([key, value]) => {
    update[`attempts.$[a].${key}`] = value;
  });
  await AgentRun.updateOne(
    { _id: runId },
    { $set: update },
    { arrayFilters: [{ "a.index": index }] }
  );
}

/**
 * Record a Gemini call for quota auditing.
 * @param {string} runId - Run id.
 * @param {Object} result - Gemini client result.
 * @param {number} attemptIndex - Attempt number.
 * @returns {Promise<void>} Resolves when recorded.
 */
async function recordGeminiCall(runId, result, attemptIndex) {
  await AgentRun.updateOne(
    { _id: runId },
    {
      $push: {
        geminiCalls: {
          at: new Date(),
          model: result.model,
          attemptIndex,
          promptTokens: result.promptTokens,
          responseTokens: result.responseTokens,
          thoughtTokens: result.thoughtTokens || 0,
          totalTokens: result.totalTokens,
          finishReason: result.finishReason || "",
          latencyMs: result.latencyMs,
          retries: result.retries
        }
      }
    }
  );
}

/**
 * Mark a run terminally failed and persist the reason.
 * @param {import("mongoose").Document} run - The run.
 * @param {string} status - Terminal status.
 * @param {string} message - Failure message.
 * @param {string} code - Stable error code.
 * @param {number} startedAt - Run start timestamp.
 * @returns {Promise<void>} Resolves when saved.
 */
async function finalizeFailure(run, status, message, code, startedAt) {
  const runId = run._id.toString();
  await AgentRun.updateOne(
    { _id: run._id },
    {
      $set: {
        status,
        error: { message, code },
        totalDurationMs: Date.now() - startedAt,
        finishedAt: new Date()
      }
    }
  );
  pubsub.publish(runId, "status", { status });
  pubsub.publish(runId, "done", { status, error: { message, code } });
  logger.error({ message: "Agent run failed", runId, status, code, error: message });
}

/**
 * Execute one run end to end.
 * @param {string} runId - AgentRun id.
 * @returns {Promise<Object>} Final run summary.
 */
async function runAgent(runId) {
  const startedAt = Date.now();

  const run = await AgentRun.findById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const task = await AgentTask.findById(run.taskId);
  if (!task) {
    await finalizeFailure(run, "failed", `Task not found: ${run.taskId}`, "TASK_NOT_FOUND", startedAt);
    return { status: "failed" };
  }

  await AgentRun.updateOne({ _id: run._id }, { $set: { startedAt: new Date() } });
  emitLog(runId, `Starting run for task "${task.name}"`);

  // DEMO_CACHE replays a previous successful run for this task without touching
  // the API, so a live demo cannot fail on a rate limit. It is explicitly opt-in
  // and the replay is labelled as such in the run record — it must never be
  // mistakable for a fresh execution.
  if (config.gemini.demoCache) {
    const replayed = await demoCache.replay(run, task, startedAt);
    if (replayed) return replayed;
    emitLog(runId, "DEMO_CACHE is on but no cached run exists yet — executing for real", "warn");
  }

  const budget = createRunBudget();
  const maxAttempts = config.agent.maxAttempts;

  let previousFailure = null;

  for (let index = 1; index <= maxAttempts; index += 1) {
    const attemptStartedAt = new Date();
    pubsub.publish(runId, "attempt_start", { index, maxAttempts });

    // ---- generate -------------------------------------------------------
    await setStatus(run, index === 1 ? "planning" : "retrying");
    emitLog(runId, `Attempt ${index}/${maxAttempts}: asking ${config.gemini.model} for code`);

    const prompt = previousFailure
      ? prompts.buildCorrectionPrompt(task, previousFailure)
      : prompts.buildInitialPrompt(task);

    let generated;
    let parsed;
    try {
      // The per-run budget is consumed HERE, before the call goes out, because
      // the orchestrator owns the run. Charging it inside the client would tie
      // this loop's budget checks to that client's implementation.
      budget.consume();

      generated = await geminiClient.generate({
        prompt,
        runId,
        attemptIndex: index
      });
      await recordGeminiCall(runId, generated, index);
      parsed = prompts.parseResponse(generated.text);
    } catch (error) {
      // Budget and cap overruns are terminal by design — retrying is precisely
      // what these limits exist to prevent.
      if (error instanceof BudgetExceededError) {
        await finalizeFailure(run, "budget_exceeded", error.message, error.code, startedAt);
        return { status: "budget_exceeded" };
      }
      if (error instanceof DailyCapExceededError) {
        await finalizeFailure(run, "failed", error.message, error.code, startedAt);
        return { status: "failed" };
      }
      // A pinned model that cannot serve fails loudly rather than silently
      // substituting a different one.
      if (error instanceof ModelUnavailableError) {
        await finalizeFailure(run, "failed", error.message, error.code, startedAt);
        return { status: "failed" };
      }
      await finalizeFailure(run, "failed", error.message, "GENERATION_FAILED", startedAt);
      return { status: "failed" };
    }

    if (Buffer.byteLength(parsed.code, "utf8") > config.sandbox.codeMaxBytes) {
      await finalizeFailure(
        run,
        "failed",
        `Generated code is ${Buffer.byteLength(parsed.code, "utf8")} bytes, over the ` +
          `${config.sandbox.codeMaxBytes} byte limit.`,
        "CODE_TOO_LARGE",
        startedAt
      );
      return { status: "failed" };
    }

    await appendAttempt(runId, {
      index,
      plan: parsed.plan,
      generatedCode: parsed.code,
      promptVersion: prompts.PROMPT_VERSION,
      model: generated.model,
      startedAt: attemptStartedAt
    });

    // ---- execute --------------------------------------------------------
    await setStatus(run, "executing");
    emitLog(runId, `Attempt ${index}: executing in sandbox`);

    const files = [
      { name: "main.js", content: parsed.code },
      ...(task.fixtures || []).map((f) => ({ name: f.name, content: f.content }))
    ];

    let result;
    try {
      result = await executor.execute({
        runId,
        files,
        entrypoint: "main.js",
        binds: artifacts.buildSandboxBinds(runId)
      });
    } catch (error) {
      // A sandbox that cannot even start is an infrastructure fault, not a
      // failure of the generated code — feeding it back to the model would just
      // produce a confused correction.
      await patchAttempt(runId, index, {
        stderr: `sandbox error: ${error.message}`,
        exitCode: null,
        finishedAt: new Date()
      });
      await finalizeFailure(run, "failed", `Sandbox failed: ${error.message}`, "SANDBOX_ERROR", startedAt);
      return { status: "failed" };
    }

    await patchAttempt(runId, index, {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      outputTruncated: result.outputTruncated,
      finishedAt: new Date()
    });

    pubsub.publish(runId, "attempt_result", {
      index,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr
    });

    const ranCleanly = result.exitCode === 0 && !result.timedOut;

    // A clean exit is necessary but NOT sufficient. Artifacts are collected
    // first so the validator has something to read, then checked against the
    // task's exact expected values. Three live runs exited 0 while emitting
    // wrong numbers; without this check all three were recorded as successes.
    let validation = { applicable: false, passed: true, failures: [], checked: 0 };
    let collected = [];

    if (ranCleanly) {
      collected = await artifacts.collectAndPublish(run, task, runId);
      validation = validator.validateArtifact(task, runId);

      if (validation.applicable) {
        emitLog(
          runId,
          validation.passed
            ? `Attempt ${index}: exit 0 and all ${validation.checked} output checks passed`
            : `Attempt ${index}: exit 0 but ${validation.failures.length}/${validation.checked} output checks FAILED`,
          validation.passed ? "info" : "warn"
        );
        pubsub.publish(runId, "validation", {
          index,
          passed: validation.passed,
          checked: validation.checked,
          failures: validation.failures
        });
      }
    }

    if (ranCleanly && validation.passed) {
      emitLog(runId, `Attempt ${index} succeeded (exit 0${validation.applicable ? ", output verified" : ""})`);

      await AgentRun.updateOne(
        { _id: run._id },
        {
          $set: {
            status: "succeeded",
            // null when the task declares no validator — correctness was never
            // established, and that must not look the same as verified.
            validated: validation.applicable ? true : null,
            validationSummary: validation.applicable
              ? `All ${validation.checked} output checks passed`
              : "",
            totalDurationMs: Date.now() - startedAt,
            finishedAt: new Date()
          }
        }
      );
      pubsub.publish(runId, "status", { status: "succeeded" });
      pubsub.publish(runId, "done", {
        status: "succeeded",
        artifacts: collected.length,
        validated: validation.applicable ? true : null
      });

      logger.info({
        message: "Agent run succeeded",
        runId,
        attempts: index,
        geminiCalls: budget.used(),
        artifacts: collected.length,
        validated: validation.applicable ? true : null,
        checksPassed: validation.checked,
        totalDurationMs: Date.now() - startedAt
      });
      return { status: "succeeded", attempts: index, validated: validation.applicable ? true : null };
    }

    // ---- failed: prepare the correction ---------------------------------
    const validationSummary =
      !validation.passed && validation.failures.length
        ? validator.describeFailures(validation.failures, validation.checked)
        : "";

    if (!ranCleanly) {
      emitLog(
        runId,
        result.timedOut
          ? `Attempt ${index} TIMED OUT after ${result.durationMs}ms`
          : `Attempt ${index} failed with exit code ${result.exitCode}`,
        "warn"
      );
    }

    // Persist WHY a zero-exit attempt was rejected, so the run history shows
    // the mismatch rather than an unexplained retry after a clean exit.
    if (validationSummary) {
      await patchAttempt(runId, index, { validationFailures: validation.failures });
    }

    previousFailure = {
      attemptIndex: index,
      code: parsed.code,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      validationFailures: validation.failures,
      validationSummary
    };

    // Stop before spending a call we cannot afford: the next iteration would
    // generate first and only then discover the budget is gone.
    if (index < maxAttempts && !budget.hasRemaining()) {
      await finalizeFailure(
        run,
        "budget_exceeded",
        `Run exhausted its Gemini call budget of ${budget.limit()} after ${index} attempts`,
        "BUDGET_EXCEEDED",
        startedAt
      );
      return { status: "budget_exceeded" };
    }
  }

  // Exhausted every attempt. A timeout on the final attempt is reported as
  // `timeout` rather than `failed`, because the distinction changes what a
  // person would do about it.
  const lastTimedOut = previousFailure && previousFailure.timedOut;
  const lastFailedValidation = Boolean(previousFailure && previousFailure.validationSummary);

  await finalizeFailure(
    run,
    lastTimedOut ? "timeout" : "failed",
    lastFailedValidation
      ? `All ${maxAttempts} attempts failed. The final attempt ran cleanly but produced wrong output: ${previousFailure.validationSummary}`
      : `All ${maxAttempts} attempts failed. Last exit code: ${
          previousFailure ? previousFailure.exitCode : "unknown"
        }`,
    lastTimedOut ? "TIMEOUT" : lastFailedValidation ? "VALIDATION_FAILED" : "MAX_ATTEMPTS_EXHAUSTED",
    startedAt
  );

  // Record the correctness verdict separately from the status. A run that
  // exited 0 every time but never matched the expected values is a DIFFERENT
  // animal from one that crashed, and the run history must not conflate them.
  if (lastFailedValidation) {
    await AgentRun.updateOne(
      { _id: run._id },
      {
        $set: {
          validated: false,
          validationSummary: previousFailure.validationSummary
        }
      }
    );
  }

  return { status: lastTimedOut ? "timeout" : "failed", validated: lastFailedValidation ? false : null };
}

module.exports = { runAgent };
