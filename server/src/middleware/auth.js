const AppError = require("../utils/AppError");
const { verifyAccessToken } = require("../services/auth.service");

/**
 * Authenticate JWT access tokens for protected routes.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @param {import("express").NextFunction} next - Express next.
 * @returns {void}
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;

  if (!token) {
    return next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
  }

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch (error) {
    return next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
  }
}

module.exports = authenticate;
