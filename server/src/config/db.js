const mongoose = require("mongoose");
const config = require("./index");
const logger = require("../utils/logger");

const MAX_RETRIES = 5;

/**
 * Connect to MongoDB with retries and exponential backoff.
 * @returns {Promise<void>} Resolves when connected.
 */
async function connectWithRetry() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await mongoose.connect(config.mongoUri, {
        autoIndex: config.env !== "production"
      });
      logger.info({ message: "MongoDB connected" });
      return;
    } catch (error) {
      logger.error({ message: "MongoDB connection failed", attempt, error });
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Disconnect from MongoDB.
 * @returns {Promise<void>} Resolves when disconnected.
 */
async function disconnect() {
  await mongoose.disconnect();
  logger.info({ message: "MongoDB disconnected" });
}

module.exports = {
  connectWithRetry,
  disconnect
};
