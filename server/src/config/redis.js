const Redis = require("ioredis");
const Redlock = require("redlock");
const config = require("./index");
const logger = require("../utils/logger");

let redisAvailable = false;
let redisClient = null;
let redisPub = null;
let redisSub = null;
let redlock = null;

/**
 * Create a Redis client instance.
 * @param {string} name - Client name for logging.
 * @returns {Redis} Redis client instance.
 */
function createRedisClient(name) {
  const client = new Redis(config.redisUrl, {
    enableOfflineQueue: false,
    lazyConnect: false
  });

  client.on("ready", () => {
    redisAvailable = true;
    logger.info({ message: "Redis ready", name });
  });

  client.on("error", (error) => {
    redisAvailable = false;
    logger.warn({ message: "Redis error", name, error });
  });

  client.on("close", () => {
    redisAvailable = false;
    logger.warn({ message: "Redis connection closed", name });
  });

  return client;
}

/**
 * Initialize Redis clients and redlock.
 * @returns {void}
 */
function initRedis() {
  if (!config.redisUrl) {
    logger.warn({ message: "Redis URL missing, running without Redis" });
    return;
  }

  redisClient = createRedisClient("client");
  redisPub = createRedisClient("pub");
  redisSub = createRedisClient("sub");

  redlock = new Redlock([redisClient], {
    retryCount: 3,
    retryDelay: 200,
    retryJitter: 200
  });
}

/**
 * Check if Redis is available.
 * @returns {boolean} True when Redis is ready.
 */
function isRedisReady() {
  return Boolean(redisAvailable);
}

/**
 * Get Redlock instance when Redis is available.
 * @returns {Redlock|null} Redlock instance or null.
 */
function getRedlock() {
  return redisAvailable ? redlock : null;
}

/**
 * Close Redis connections.
 * @returns {Promise<void>} Resolves when connections close.
 */
async function closeRedis() {
  const clients = [redisClient, redisPub, redisSub].filter(Boolean);
  await Promise.all(clients.map((client) => client.quit()));
  logger.info({ message: "Redis disconnected" });
}

module.exports = {
  initRedis,
  isRedisReady,
  getRedlock,
  closeRedis,
  get redisClient() {
    return redisClient;
  },
  get redisPub() {
    return redisPub;
  },
  get redisSub() {
    return redisSub;
  }
};
