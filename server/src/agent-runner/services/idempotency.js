const config = require("../config");
const logger = require("../../utils/logger");
const { createConnection, isRedisConfigured } = require("../queue/connection");

/**
 * Webhook idempotency.
 *
 * Replayed deliveries are common and expected — senders retry on timeout, and a
 * timeout does not mean the request failed. Without a guard, one retried
 * delivery costs a duplicate sandbox execution and a duplicate slice of the
 * shared Gemini budget.
 *
 * Two independent layers:
 *   1. This Redis claim, which resolves the common case fast and remembers the
 *      resulting runId so a replay can be answered with the ORIGINAL run.
 *   2. A unique partial index on AgentRun.idempotencyKey, which is the actual
 *      correctness guarantee if two deliveries race past the check together.
 *
 * Layer 1 is an optimisation; layer 2 is the invariant. If Redis is down the
 * system stays correct, just noisier.
 */

const PENDING = "__pending__";

/** @type {import("ioredis")|null} */
let client = null;

/**
 * Lazily create the Redis client used for idempotency claims.
 * @returns {import("ioredis")|null} Redis client, or null when unavailable.
 */
function getClient() {
  if (client) return client;
  if (!isRedisConfigured()) return null;
  client = createConnection("idempotency");
  return client;
}

/**
 * Namespaced key on the runner's dedicated Redis DB.
 * @param {string} key - Raw idempotency key.
 * @returns {string} Namespaced key.
 */
function buildKey(key) {
  return `${config.queue.prefix}:idem:${key}`;
}

/**
 * Attempt to claim an idempotency key.
 * @param {string} key - Idempotency key.
 * @returns {Promise<{claimed: boolean, runId: string|null, pending: boolean}>} Claim result.
 */
async function claim(key) {
  const redis = getClient();
  if (!redis) {
    // No Redis: let the Mongo unique index be the guard.
    return { claimed: true, runId: null, pending: false };
  }

  try {
    const result = await redis.set(
      buildKey(key),
      PENDING,
      "EX",
      config.webhook.idempotencyTtlSec,
      "NX"
    );

    if (result === "OK") {
      return { claimed: true, runId: null, pending: false };
    }

    const existing = await redis.get(buildKey(key));
    if (existing && existing !== PENDING) {
      return { claimed: false, runId: existing, pending: false };
    }
    // A concurrent delivery holds the claim but has not recorded its runId yet.
    return { claimed: false, runId: null, pending: true };
  } catch (error) {
    logger.warn({ message: "Idempotency claim failed, relying on Mongo index", error: error.message });
    return { claimed: true, runId: null, pending: false };
  }
}

/**
 * Record the run that a claimed key produced, so replays resolve to it.
 * @param {string} key - Idempotency key.
 * @param {string} runId - AgentRun id.
 * @returns {Promise<void>} Resolves when recorded.
 */
async function record(key, runId) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.set(buildKey(key), runId, "EX", config.webhook.idempotencyTtlSec);
  } catch (error) {
    logger.warn({ message: "Failed to record idempotency result", error: error.message });
  }
}

/**
 * Release a claim after a failure, so a legitimate retry is not blocked by a
 * key that never produced a run.
 * @param {string} key - Idempotency key.
 * @returns {Promise<void>} Resolves when released.
 */
async function release(key) {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(buildKey(key));
  } catch (error) {
    logger.warn({ message: "Failed to release idempotency claim", error: error.message });
  }
}

module.exports = { claim, record, release };
