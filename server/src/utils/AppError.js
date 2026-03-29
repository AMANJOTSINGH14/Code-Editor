/**
 * Custom application error with operational flag.
 */
class AppError extends Error {
  /**
   * Create an AppError.
   * @param {string} message - Error message.
   * @param {number} statusCode - HTTP status code.
   * @param {string} code - Stable error code.
   * @param {Array<unknown>} [errors] - Optional validation errors.
   */
  constructor(message, statusCode, code, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    this.isOperational = true;
  }
}

module.exports = AppError;
