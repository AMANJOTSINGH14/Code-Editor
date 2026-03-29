const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const config = require("../config");

const SALT_ROUNDS = 12;

/**
 * Hash a plain text password.
 * @param {string} password - Plain text password.
 * @returns {Promise<string>} Hashed password.
 */
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a password with a hash.
 * @param {string} password - Plain text password.
 * @param {string} hash - Stored password hash.
 * @returns {Promise<boolean>} True when password matches.
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Sign an access token.
 * @param {{id: string, email: string, name: string}} user - User payload.
 * @returns {string} Signed JWT access token.
 */
function signAccessToken(user) {
  return jwt.sign(user, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn
  });
}

/**
 * Sign a refresh token.
 * @param {{id: string}} user - User payload.
 * @returns {string} Signed JWT refresh token.
 */
function signRefreshToken(user) {
  return jwt.sign(user, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn
  });
}

/**
 * Verify access token and return payload.
 * @param {string} token - JWT access token.
 * @returns {{id: string, email: string, name: string}} Token payload.
 */
function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

/**
 * Verify refresh token and return payload.
 * @param {string} token - JWT refresh token.
 * @returns {{id: string}} Token payload.
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

/**
 * Register a new user.
 * @param {Object} payload - Registration payload.
 * @param {string} payload.name - User name.
 * @param {string} payload.email - Email address.
 * @param {string} payload.password - Plain text password.
 * @returns {Promise<{user: Object, accessToken: string, refreshToken: string}>} Auth data.
 */
async function registerUser({ name, email, password }) {
  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError("Email already registered", 409, "EMAIL_TAKEN");
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({ name, email, passwordHash });
  const safeUser = user.toSafeObject();

  const accessToken = signAccessToken(safeUser);
  const refreshToken = signRefreshToken({ id: safeUser.id });

  return { user: safeUser, accessToken, refreshToken };
}

/**
 * Authenticate a user and issue tokens.
 * @param {Object} payload - Login payload.
 * @param {string} payload.email - Email address.
 * @param {string} payload.password - Plain text password.
 * @returns {Promise<{user: Object, accessToken: string, refreshToken: string}>} Auth data.
 */
async function loginUser({ email, password }) {
  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  const matches = await comparePassword(password, user.passwordHash);
  if (!matches) {
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  const safeUser = user.toSafeObject();
  const accessToken = signAccessToken(safeUser);
  const refreshToken = signRefreshToken({ id: safeUser.id });

  return { user: safeUser, accessToken, refreshToken };
}

/**
 * Refresh access and refresh tokens.
 * @param {string} refreshToken - Refresh token string.
 * @returns {Promise<{user: Object, accessToken: string, refreshToken: string}>} Auth data.
 */
async function refreshTokens(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);
  const user = await User.findById(payload.id);
  if (!user) {
    throw new AppError("Invalid refresh token", 401, "INVALID_TOKEN");
  }

  const safeUser = user.toSafeObject();
  const accessToken = signAccessToken(safeUser);
  const newRefreshToken = signRefreshToken({ id: safeUser.id });

  return { user: safeUser, accessToken, refreshToken: newRefreshToken };
}

module.exports = {
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  registerUser,
  loginUser,
  refreshTokens
};
