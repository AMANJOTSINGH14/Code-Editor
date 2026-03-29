const asyncHandler = require("../utils/asyncHandler");
const { registerUser, loginUser, refreshTokens } = require("../services/auth.service");
const config = require("../config");
const AppError = require("../utils/AppError");

/**
 * Set refresh token cookie.
 * @param {import("express").Response} res - Express response.
 * @param {string} token - Refresh token.
 * @returns {void}
 */
function setRefreshCookie(res, token) {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    domain: config.cookies.domain || undefined,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

/**
 * Register a new user.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await registerUser(req.body);
  setRefreshCookie(res, refreshToken);
  res.status(201).json({
    success: true,
    data: {
      user,
      accessToken
    }
  });
});

/**
 * Login a user.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await loginUser(req.body);
  setRefreshCookie(res, refreshToken);
  res.status(200).json({
    success: true,
    data: {
      user,
      accessToken
    }
  });
});

/**
 * Refresh access and refresh tokens.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    throw new AppError("Missing refresh token", 401, "UNAUTHORIZED");
  }

  const { user, accessToken, refreshToken: newRefresh } = await refreshTokens(refreshToken);
  setRefreshCookie(res, newRefresh);

  res.status(200).json({
    success: true,
    data: {
      user,
      accessToken
    }
  });
});

module.exports = {
  register,
  login,
  refresh
};
