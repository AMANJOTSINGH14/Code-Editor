const IORedis = require("ioredis");
const config = require("../config");
const logger = require("../../utils/logger");

/**
 * Redis connections owned by the Agent Runner.
 *
 * These are deliberately NOT the clients from src/config/redis.js. Two reasons:
 *
 *  1. That module creates clients with `enableOfflineQueue: false`, and BullMQ
 *     requires `maxRetriesPerRequest: null` plus blocking commands (BRPOPLPUSH
 *     et al). Sharing those clients breaks the queue.
 *  2. Keyspace isolation. The host app's keys all live on DB 0 under the
 *     "collab:" prefix (`collab:api:*`, `collab:review:*`, `collab:docs:meta:*`,
 *     `collab:version:publish:*`, `collab:room:*`, `collab:user:*`), and
 *     Socket.io's adapter uses its own DB 0 channels. Everything opened here
 *     targets a dedicated logical DB (default 3), so a collision is structurally
 *     impossible rather than merely unlikely — with the "agentrunner" BullMQ
 *     prefix as a second, independent layer.
 *
 * Same Redis server, separate DB, separate clients, separate lifecycle.
 *
 * ONE EXCEPTION, stated precisely: the two route rate limiters in
 * routes/runs.routes.js reuse the app's existing createRateLimiter middleware,
 * which writes through the app's own client on DB 0. Those keys are namespaced
 * `collab:agentrunner:webhook:*` and `collab:agentrunner:manual:*` — still
 * collision-free, but they are on DB 0, not here. tests/agent-runner/
 * isolation.test.js pins both facts.
 */

/** @type {IORedis[]} */
const connections = [];

/**
 * Whether Redis is configured at all. The host app treats Redis as optional; the
 * runner cannot work without it, so callers must check this before enqueuing.
 * @returns {boolean} True when a Redis URL is configured.
 */
function isRedisConfigured() {
  return Boolean(config.redis.url);
}

/**
 * Create a Redis connection pinned to the runner's dedicated DB index.
 *
 * `db` is passed explicitly so it wins over any database segment in the URL —
 * the isolation guarantee must not depend on how REDIS_URL happens to be written.
 * @param {string} name - Connection name, for logs.
 * @returns {IORedis} Redis connection.
 */
function createConnection(name) {
  const connection = new IORedis(config.redis.url, {
    db: config.redis.db,
    // Required by BullMQ: it must be able to block indefinitely on a command.
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false
  });

  connection.on("ready", () => {
    logger.info({
      message: "Agent runner Redis ready",
      name,
      db: config.redis.db,
      prefix: config.queue.prefix
    });
  });

  connection.on("error", (error) => {
    logger.warn({ message: "Agent runner Redis error", name, error: error.message });
  });

  connections.push(connection);
  return connection;
}

/**
 * Close every connection this module opened. Called from the runner's shutdown
 * hook so the subsystem cleans up after itself.
 * @returns {Promise<void>} Resolves when all connections are closed.
 */
async function closeConnections() {
  await Promise.all(
    connections.map((connection) =>
      connection.quit().catch(() => connection.disconnect())
    )
  );
  connections.length = 0;
  logger.info({ message: "Agent runner Redis connections closed" });
}

module.exports = {
  isRedisConfigured,
  createConnection,
  closeConnections
};
