const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const config = require("../config");

/**
 * Format and send error responses.
 * @param {Error} err - Thrown error.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @param {import("express").NextFunction} next - Express next.
 * @returns {void}
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err && err.name === "ZodError") {
    const details = err.issues || [];
    const validationError = new AppError("Validation failed", 400, "VALIDATION_ERROR", details);
    return res.status(validationError.statusCode).json({
      success: false,
      error: {
        message: validationError.message,
        code: validationError.code,
        details: validationError.errors
      }
    });
  }

  if (err && err.name === "CastError") {
    const castError = new AppError("Invalid identifier", 400, "INVALID_ID");
    return res.status(castError.statusCode).json({
      success: false,
      error: {
        message: castError.message,
        code: castError.code,
        details: []
      }
    });
  }

  if (err && err.code === 11000) {
    const duplicateError = new AppError("Duplicate resource", 409, "DUPLICATE_RESOURCE");
    return res.status(duplicateError.statusCode).json({
      success: false,
      error: {
        message: duplicateError.message,
        code: duplicateError.code,
        details: []
      }
    });
  }

  if (err && err.isOperational) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: {
        message: err.message,
        code: err.code || "OPERATIONAL_ERROR",
        details: err.errors || []
      }
    });
  }

  logger.error({ message: "Unhandled error", error: err });

  return res.status(500).json({
    success: false,
    error: {
      message: config.env === "production" ? "Internal server error" : err.message,
      code: "INTERNAL_ERROR",
      details: config.env === "production" ? [] : [err.stack]
    }
  });
}

module.exports = errorHandler;
