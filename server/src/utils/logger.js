const winston = require("winston");

const { combine, timestamp, errors, json } = winston.format;

/**
 * Create a structured application logger.
 * @returns {import("winston").Logger} Winston logger instance.
 */
function createLogger() {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: combine(timestamp(), errors({ stack: true }), json()),
    transports: [new winston.transports.Console()]
  });
}

const logger = createLogger();

module.exports = logger;
module.exports.createLogger = createLogger;
