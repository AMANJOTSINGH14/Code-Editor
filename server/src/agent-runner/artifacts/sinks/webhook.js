const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../../config");
const logger = require("../../../utils/logger");

/**
 * Outbound webhook sink.
 *
 * POSTs run metadata plus artifact contents to a configured URL. Signed with the
 * same scheme the inbound webhook uses, so a receiver can verify the payload
 * really came from this runner.
 */

// Small artifacts are inlined base64; larger ones are referenced by their
// download URL instead. Posting a multi-megabyte body to an unknown receiver is
// a good way to get rate-limited or silently dropped.
const MAX_INLINE_BYTES = 256 * 1024;

/**
 * Deliver artifacts to the configured webhook.
 * @param {Object} options - Delivery options.
 * @param {import("mongoose").Document} options.run - The run.
 * @param {import("mongoose").Document} options.task - The task.
 * @param {string} options.runId - Run id.
 * @param {Object[]} options.artifacts - Artifact metadata.
 * @param {string} options.dir - Artifact directory.
 * @returns {Promise<{delivered: boolean, status?: number}>} Delivery result.
 */
async function deliver({ run, task, runId, artifacts, dir }) {
  if (!config.artifacts.webhookUrl) {
    // Configured as an active sink but with no URL: skip quietly rather than
    // failing a run whose actual work succeeded.
    logger.info({ message: "Webhook sink enabled but no URL configured, skipping", runId });
    return { delivered: false };
  }

  const files = artifacts.map((artifact) => {
    const base = {
      name: artifact.name,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256
    };
    if (artifact.sizeBytes <= MAX_INLINE_BYTES) {
      try {
        base.contentBase64 = fs.readFileSync(path.join(dir, artifact.name)).toString("base64");
      } catch {
        // Metadata alone is still useful to the receiver.
      }
    }
    return base;
  });

  const payload = JSON.stringify({
    runId,
    taskSlug: task.slug,
    taskName: task.name,
    status: run.status,
    attempts: run.attempts ? run.attempts.length : 0,
    artifacts: files,
    at: new Date().toISOString()
  });

  const headers = { "Content-Type": "application/json" };

  if (config.artifacts.webhookSecret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHmac("sha256", config.artifacts.webhookSecret)
      .update(`v1:${timestamp}:`)
      .update(payload)
      .digest("hex");
    headers["x-agentrunner-timestamp"] = timestamp;
    headers["x-agentrunner-signature"] = `v1=${signature}`;
  }

  // Bounded: a hanging receiver must not hold the worker open, since the worker
  // is concurrency 1 and every other run queues behind it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(config.artifacts.webhookUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal
    });
    logger.info({
      message: "Artifact webhook delivered",
      runId,
      status: res.status,
      artifacts: files.length
    });
    return { delivered: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { deliver, name: "webhook", MAX_INLINE_BYTES };
