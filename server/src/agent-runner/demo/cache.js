const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");
const AgentRun = require("../models/AgentRun");
const pubsub = require("../stream/pubsub");
const artifacts = require("../artifacts");

/**
 * DEMO_CACHE replay.
 *
 * Replays the last successful run of the same task from Mongo, without calling
 * Gemini and without starting a container, so a live demo can never fail on a
 * rate limit.
 *
 * The replayed run is explicitly marked `replayedFrom` in its error field and
 * announced on the event stream. That labelling is not optional: a cached replay
 * that looked identical to a real execution would make every demo unfalsifiable,
 * which is worse than the rate limit it protects against.
 *
 * Replay is opt-in via DEMO_CACHE=true and falls through to a real run when no
 * cached run exists.
 */

/**
 * Replay the most recent successful run for this task, if one exists.
 * @param {import("mongoose").Document} run - The run to populate.
 * @param {import("mongoose").Document} task - The task.
 * @param {number} startedAt - Run start timestamp.
 * @returns {Promise<Object|null>} Replay summary, or null when nothing is cached.
 */
async function replay(run, task, startedAt) {
  const runId = run._id.toString();

  // Source must be a genuine LIVE run, never another replay.
  //
  // Without this exclusion the newest "succeeded" run is often itself a replay,
  // so replays chain off replays. Each generation copies from a record whose
  // artifact bytes were never on disk, and the artifact list degrades to empty —
  // observed live: replay 2 sourced replay 1 and produced no downloadable files.
  // Requiring geminiCalls to be non-empty is the reliable discriminator, since a
  // replay never fabricates call records.
  const source = await AgentRun.findOne({
    taskId: task._id,
    status: "succeeded",
    _id: { $ne: run._id },
    "error.code": { $ne: "DEMO_CACHE_REPLAY" },
    "geminiCalls.0": { $exists: true }
  }).sort({ finishedAt: -1 });

  if (!source) {
    logger.info({
      message: "DEMO_CACHE found no live run to replay — falling through to a real run",
      runId,
      task: task.slug
    });
    return null;
  }

  logger.info({
    message: "DEMO_CACHE replaying previous run",
    runId,
    sourceRunId: source._id.toString(),
    task: task.slug
  });

  // Copy the artifact FILES, not just their metadata.
  //
  // Without this the replayed run advertises artifacts it does not have: the
  // download route resolves <artifacts>/<runId>/<name>, the bytes are still
  // under the SOURCE run's directory, and every download 404s while the UI
  // cheerfully shows a Download button. Found during live verification — this
  // is precisely the failure DEMO_CACHE exists to prevent, so it must not be
  // the thing that breaks the demo.
  const copied = [];
  try {
    const sourceDir = artifacts.localRunDir(source._id.toString());
    const targetDir = artifacts.localRunDir(runId);
    if (fs.existsSync(sourceDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      for (const artifact of source.artifacts) {
        const from = path.join(sourceDir, artifact.name);
        if (!fs.existsSync(from)) continue;
        fs.copyFileSync(from, path.join(targetDir, artifact.name));
        copied.push(artifact.name);
      }
    }
  } catch (error) {
    // A copy failure must not fail the replay — the run history is still
    // meaningful without downloadable bytes.
    logger.warn({ message: "DEMO_CACHE artifact copy failed", runId, error: error.message });
  }

  // Only advertise artifacts whose bytes actually made it across, so the UI
  // never offers a download that cannot succeed.
  const replayedArtifacts = source.artifacts.filter((a) => copied.includes(a.name));
  logger.info({ message: "DEMO_CACHE artifacts copied", runId, count: copied.length });

  pubsub.publish(runId, "log", {
    message: `DEMO_CACHE: replaying run ${source._id} — no API calls, no container started`,
    level: "warn"
  });

  // Walk the cached attempts so a viewer watching the stream sees the same
  // sequence of events a real run produces, in the same order.
  for (const attempt of source.attempts) {
    pubsub.publish(runId, "attempt_start", { index: attempt.index, maxAttempts: source.attempts.length });
    pubsub.publish(runId, "attempt_result", {
      index: attempt.index,
      exitCode: attempt.exitCode,
      timedOut: attempt.timedOut,
      durationMs: attempt.durationMs,
      stdout: attempt.stdout,
      stderr: attempt.stderr
    });
  }

  await AgentRun.updateOne(
    { _id: run._id },
    {
      $set: {
        status: "succeeded",
        attempts: source.attempts,
        artifacts: replayedArtifacts,
        // Deliberately NOT copied: replaying must not fabricate quota
        // consumption that never happened.
        geminiCalls: [],
        totalDurationMs: Date.now() - startedAt,
        finishedAt: new Date(),
        error: {
          message: `DEMO_CACHE replay of run ${source._id} — not a live execution`,
          code: "DEMO_CACHE_REPLAY"
        }
      }
    }
  );

  replayedArtifacts.forEach((artifact) => {
    pubsub.publish(runId, "artifact", {
      name: artifact.name,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256
    });
  });

  pubsub.publish(runId, "status", { status: "succeeded" });
  pubsub.publish(runId, "done", { status: "succeeded", replayed: true, sourceRunId: source._id.toString() });

  return { status: "succeeded", replayed: true, sourceRunId: source._id.toString() };
}

module.exports = { replay };
