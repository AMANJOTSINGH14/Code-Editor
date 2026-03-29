const AppError = require("../utils/AppError");
const redis = require("../config/redis");

const memoryBuckets = new Map();

/**
 * Resolve the identifier for rate limiting.
 * @param {import("express").Request} req - Express request.
 * @returns {string} Rate limit key.
 */
function defaultKeyResolver(req) {
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.ip}`;
}

/**
 * Create a rate limiting middleware with Redis or in-memory fallback.
 * @param {Object} options - Rate limiter options.
 * @param {string} options.keyPrefix - Key prefix for storage.
 * @param {number} options.windowMs - Window size in milliseconds.
 * @param {number} options.max - Maximum requests per window.
 * @param {Function} [options.keyResolver] - Function to resolve rate limit key.
 * @returns {import("express").RequestHandler} Express middleware.
 */
function createRateLimiter({ keyPrefix, windowMs, max, keyResolver = defaultKeyResolver }) {
  return async (req, res, next) => {
    const identifier = keyResolver(req);
    const key = `${keyPrefix}:${identifier}`;
    const now = Date.now();

    if (redis.isRedisReady() && redis.redisClient) {
      const pipeline = redis.redisClient.multi();
      pipeline.zremrangebyscore(key, 0, now - windowMs);
      pipeline.zadd(key, now, `${now}`);
      pipeline.zcard(key);
      pipeline.expire(key, Math.ceil(windowMs / 1000));

      const results = await pipeline.exec();
      const count = results && results[2] ? Number(results[2][1]) : 0;

      if (count > max) {
        return next(new AppError("Rate limit exceeded", 429, "RATE_LIMIT"));
      }

      return next();
    }

    const existing = memoryBuckets.get(key) || [];
    const filtered = existing.filter((timestamp) => timestamp > now - windowMs);
    filtered.push(now);
    memoryBuckets.set(key, filtered);

    if (filtered.length > max) {
      return next(new AppError("Rate limit exceeded", 429, "RATE_LIMIT"));
    }

    return next();
  };
}

/**
 * Reset in-memory rate limiter state (tests only).
 * @returns {void}
 */
function resetRateLimiterForTest() {
  memoryBuckets.clear();
}

module.exports = {
  createRateLimiter,
  resetRateLimiterForTest
};
