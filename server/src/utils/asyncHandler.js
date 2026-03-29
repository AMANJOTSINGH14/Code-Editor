/**
 * Wrap an async handler and forward errors to Express.
 * @param {Function} handler - Async route handler.
 * @returns {Function} Express handler with error forwarding.
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
