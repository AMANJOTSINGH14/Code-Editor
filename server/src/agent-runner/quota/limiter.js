const config = require("../config");
const logger = require("../../utils/logger");
const { createConnection, isRedisConfigured } = require("../queue/connection");

/**
 * Gemini quota controls.
 *
 * The RAG reviewer shares this project's API quota, so the runner must never be
 * able to drain it. Three independent limits, in widening scope:
 *
 *   1. Token bucket  — paces the runner to N requests/minute. QUEUES on limit.
 *   2. Per-run budget — caps calls within a single run (see budget.js).
 *   3. Daily counter — global ceiling across every run, in Redis.
 */

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter that DELAYS rather than rejects.
 *
 * The specified behaviour is "on limit, queue the call and wait — never drop,
 * never error". A token-bucket that throws would surface as a failed run and
 * waste the Gemini calls already spent on earlier attempts, so callers here
 * simply wait their turn.
 *
 * Acquisitions are chained through `tail`, which serialises them: callers are
 * released strictly FIFO instead of all waking at once and stampeding past the
 * limit.
 */
class TokenBucket {
  /**
   * @param {number} capacity - Max requests per window.
   * @param {number} windowMs - Window size in milliseconds.
   */
  constructor(capacity, windowMs = 60000) {
    this.capacity = capacity;
    this.windowMs = windowMs;
    /** @type {number[]} Timestamps of recent grants. */
    this.grants = [];
    /** @type {Promise<void>} Serialises concurrent acquisitions. */
    this.tail = Promise.resolve();
  }

  /**
   * Wait until a slot is free, then consume it.
   * @returns {Promise<number>} Milliseconds spent waiting.
   */
  acquire() {
    const result = this.tail.then(() => this._acquireOne());
    // Keep the chain alive even if one acquisition rejects, or every later
    // caller would inherit the rejection.
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /**
   * Consume one slot, sleeping first if the window is full.
   * @returns {Promise<number>} Milliseconds waited.
   */
  async _acquireOne() {
    let waited = 0;

    for (;;) {
      const now = Date.now();
      this.grants = this.grants.filter((t) => now - t < this.windowMs);

      if (this.grants.length < this.capacity) {
        this.grants.push(now);
        return waited;
      }

      // Wait exactly until the oldest grant leaves the window.
      const sleepMs = this.windowMs - (now - this.grants[0]) + 5;
      logger.info({
        message: "Gemini rate limit reached, queueing call",
        waitMs: sleepMs,
        capacity: this.capacity
      });
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      waited += sleepMs;
    }
  }
}

const bucket = new TokenBucket(config.gemini.requestsPerMinute, 60000);

/**
 * Wait for a rate-limit slot.
 * @returns {Promise<number>} Milliseconds spent queued.
 */
function acquireSlot() {
  return bucket.acquire();
}

// ---------------------------------------------------------------------------
// Daily counter
// ---------------------------------------------------------------------------

/** @type {import("ioredis")|null} */
let counterClient = null;

// Used only when Redis is unavailable, so a single-instance dev run still has a
// working ceiling instead of no ceiling at all.
const memoryCounter = new Map();

/**
 * Get the Redis client for the daily counter.
 * @returns {import("ioredis")|null} Client or null.
 */
function getCounterClient() {
  if (counterClient) return counterClient;
  if (!isRedisConfigured()) return null;
  counterClient = createConnection("quota-counter");
  return counterClient;
}

/**
 * Current date in US Pacific time as YYYY-MM-DD.
 *
 * The counter "resets at midnight Pacific" simply by keying on the Pacific
 * calendar date — no scheduled job, nothing to miss if the process is down at
 * midnight. Intl handles PST/PDT transitions, so this stays correct across DST
 * without any offset arithmetic.
 * @param {Date} [now] - Instant to convert.
 * @returns {string} Date key.
 */
function pacificDateKey(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

/**
 * Redis key for today's counter.
 * @param {Date} [now] - Instant.
 * @returns {string} Key.
 */
function dailyKey(now) {
  return `${config.queue.prefix}:gemini:daily:${pacificDateKey(now)}`;
}

/**
 * Read today's Gemini call count.
 * @returns {Promise<number>} Calls used today.
 */
async function getDailyUsage() {
  const redis = getCounterClient();
  const key = dailyKey();

  if (!redis) return memoryCounter.get(key) || 0;

  try {
    const value = await redis.get(key);
    return Number(value) || 0;
  } catch (error) {
    logger.warn({ message: "Daily quota read failed", error: error.message });
    return memoryCounter.get(key) || 0;
  }
}

/**
 * Reserve one call against the daily cap.
 *
 * Increments first and rolls back on rejection, rather than checking then
 * incrementing: with a check-then-increment, two concurrent runs both read
 * cap-1 and both proceed. INCR is atomic, so the count is authoritative.
 * @returns {Promise<{allowed: boolean, used: number, cap: number}>} Reservation result.
 */
async function reserveDailyCall() {
  const cap = config.gemini.dailyCap;
  const redis = getCounterClient();
  const key = dailyKey();

  if (!redis) {
    const used = (memoryCounter.get(key) || 0) + 1;
    if (used > cap) return { allowed: false, used: used - 1, cap };
    memoryCounter.set(key, used);
    return { allowed: true, used, cap };
  }

  try {
    const used = await redis.incr(key);
    // 48h TTL: comfortably past the Pacific rollover, and self-cleaning so old
    // day keys never accumulate.
    if (used === 1) await redis.expire(key, 172800);

    if (used > cap) {
      await redis.decr(key);
      return { allowed: false, used: used - 1, cap };
    }
    return { allowed: true, used, cap };
  } catch (error) {
    // Redis failing must not silently remove the ceiling, but it also must not
    // hard-fail every run. Fall back to the in-memory counter.
    logger.warn({ message: "Daily quota reserve failed, using memory counter", error: error.message });
    const used = (memoryCounter.get(key) || 0) + 1;
    if (used > cap) return { allowed: false, used: used - 1, cap };
    memoryCounter.set(key, used);
    return { allowed: true, used, cap };
  }
}

/**
 * Return a reserved call to the daily counter when the request never happened.
 * @returns {Promise<void>} Resolves when released.
 */
async function releaseDailyCall() {
  const redis = getCounterClient();
  const key = dailyKey();

  if (!redis) {
    memoryCounter.set(key, Math.max(0, (memoryCounter.get(key) || 0) - 1));
    return;
  }
  try {
    await redis.decr(key);
  } catch {
    // Over-counting by one is the safe direction to fail.
  }
}

/**
 * Reset limiter state. Tests only.
 * @returns {void}
 */
function resetForTest() {
  bucket.grants = [];
  bucket.tail = Promise.resolve();
  memoryCounter.clear();
}

module.exports = {
  acquireSlot,
  getDailyUsage,
  reserveDailyCall,
  releaseDailyCall,
  pacificDateKey,
  dailyKey,
  TokenBucket,
  resetForTest
};
