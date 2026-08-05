const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");
const logger = require("../../utils/logger");
const AgentRun = require("../models/AgentRun");
const pubsub = require("../stream/pubsub");
const filesystemSink = require("./sinks/filesystem");
const webhookSink = require("./sinks/webhook");
const githubSink = require("./sinks/github");

/**
 * Artifact collection and delivery.
 *
 * A run's output is real files on disk, not chat text. The sandbox writes into
 * /workspace/out; that directory is a bind mount onto <artifacts>/<runId> on the
 * host, so files survive the container's removal.
 *
 * ---------------------------------------------------------------------------
 * This bind mount is a deliberate hole in the isolation boundary
 * ---------------------------------------------------------------------------
 * Everything else about the sandbox is locked down — no network, read-only
 * rootfs, dropped capabilities. This is the ONE path where code the model wrote
 * writes to the host filesystem. It is scoped to a per-run directory and the
 * container runs as uid 1000, but it is a real hole and SECURITY.md names it as
 * one. Do not widen it: never mount the artifacts root itself into a sandbox,
 * or one run could read and overwrite every other run's output.
 */

// Refuse anything that is not a plain filename when reading artifacts back out.
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9._-]+$/;

// Bounds what a single run can persist. The tmpfs cap already limits what the
// container can produce; this bounds what leaves it.
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_ARTIFACTS_PER_RUN = 20;

/**
 * Directory for a run's artifacts, as seen by THIS process.
 * @param {string} runId - Run id.
 * @returns {string} Absolute path.
 */
function localRunDir(runId) {
  return path.resolve(config.artifacts.path, runId);
}

/**
 * Directory for a run's artifacts, as seen by the DOCKER DAEMON.
 * @param {string} runId - Run id.
 * @returns {string} Path for the bind mount source.
 */
function hostRunDir(runId) {
  // Not path.resolve: this path is interpreted by the daemon, which may not
  // share this process's filesystem or working directory.
  const base = config.artifacts.hostPath.replace(/[\\/]+$/, "");
  return `${base}/${runId}`;
}

/**
 * Create the per-run artifact directory and return the sandbox bind spec.
 *
 * Called before the container starts, because Docker would otherwise create the
 * bind source itself as root and the sandbox (uid 1000) could not write to it.
 * @param {string} runId - Run id.
 * @returns {string[]} Bind specs for HostConfig.Binds.
 */
function buildSandboxBinds(runId) {
  const dir = localRunDir(runId);
  try {
    // 0o777 so uid 1000 inside the container can write regardless of which uid
    // this process runs as. Acceptable for a per-run scratch directory; noted
    // in SECURITY.md.
    fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
    fs.chmodSync(dir, 0o777);
  } catch (error) {
    logger.warn({ message: "Could not prepare artifact directory", runId, error: error.message });
    // Without a writable bind the run can still execute; it just produces no
    // artifacts. That is better than failing the run outright.
    return [];
  }
  return [`${hostRunDir(runId)}:/workspace/out:rw`];
}

/**
 * Hash a file's contents.
 * @param {string} filePath - File path.
 * @returns {string} Hex sha256.
 */
function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Collect artifacts a run produced and deliver them to configured sinks.
 * @param {import("mongoose").Document} run - The run.
 * @param {import("mongoose").Document} task - The task.
 * @param {string} runId - Run id.
 * @returns {Promise<Object[]>} Artifact metadata.
 */
async function collectAndPublish(run, task, runId) {
  const dir = localRunDir(runId);

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    logger.info({ message: "No artifact directory for run", runId });
    return [];
  }

  const collected = [];

  for (const entry of entries) {
    if (collected.length >= MAX_ARTIFACTS_PER_RUN) {
      logger.warn({ message: "Artifact count cap reached", runId, cap: MAX_ARTIFACTS_PER_RUN });
      break;
    }
    // Only regular files at the top level: a symlink could point anywhere on
    // the host, and recursing into directories the sandbox created invites
    // traversal surprises for no benefit here.
    if (!entry.isFile()) continue;
    if (!SAFE_ARTIFACT_NAME.test(entry.name)) {
      logger.warn({ message: "Skipping artifact with unsafe name", runId, name: entry.name });
      continue;
    }

    const filePath = path.join(dir, entry.name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (stat.size > MAX_ARTIFACT_BYTES) {
      logger.warn({ message: "Skipping oversized artifact", runId, name: entry.name, size: stat.size });
      continue;
    }

    collected.push({
      name: entry.name,
      sizeBytes: stat.size,
      sha256: hashFile(filePath),
      sink: "filesystem",
      location: path.join(runId, entry.name),
      createdAt: new Date()
    });
  }

  if (!collected.length) {
    logger.info({ message: "Run produced no artifacts", runId });
    return [];
  }

  await AgentRun.updateOne({ _id: run._id }, { $set: { artifacts: collected } });
  collected.forEach((artifact) => {
    pubsub.publish(runId, "artifact", {
      name: artifact.name,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256
    });
  });

  // Filesystem is the system of record and already done. The remaining sinks are
  // additional delivery: each is isolated so one failing (a webhook receiver
  // being down, a GitHub token having expired) cannot fail a run whose work is
  // complete and already persisted.
  const active = config.artifacts.sinks;

  if (active.includes("webhook")) {
    try {
      await webhookSink.deliver({ run, task, runId, artifacts: collected, dir });
    } catch (error) {
      logger.warn({ message: "Webhook artifact sink failed", runId, error: error.message });
    }
  }

  if (active.includes("github")) {
    try {
      const pr = await githubSink.deliver({ run, task, runId, artifacts: collected, dir });
      if (pr && pr.url) {
        pubsub.publish(runId, "artifact", { name: "pull-request", location: pr.url, sink: "github" });
      }
    } catch (error) {
      logger.warn({ message: "GitHub artifact sink failed", runId, error: error.message });
    }
  }

  logger.info({ message: "Artifacts collected", runId, count: collected.length });
  return collected;
}

/**
 * Resolve an artifact path for download, refusing traversal.
 * @param {string} runId - Run id.
 * @param {string} name - Artifact filename.
 * @returns {{path: string, name: string}|null} Resolved artifact, or null.
 */
function resolveArtifactPath(runId, name) {
  if (!SAFE_ARTIFACT_NAME.test(name)) return null;

  const dir = localRunDir(runId);
  const full = path.resolve(dir, name);

  // Belt and braces: even with the name whitelist, confirm the resolved path is
  // still inside the run's own directory before opening it.
  if (!full.startsWith(dir + path.sep) && full !== path.join(dir, name)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;

  return { path: full, name };
}

module.exports = {
  buildSandboxBinds,
  collectAndPublish,
  resolveArtifactPath,
  localRunDir,
  hostRunDir,
  filesystemSink,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACTS_PER_RUN
};
