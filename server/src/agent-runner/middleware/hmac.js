const crypto = require("crypto");
const AppError = require("../../utils/AppError");
const config = require("../config");
const logger = require("../../utils/logger");

/**
 * Webhook HMAC verification.
 *
 * ---------------------------------------------------------------------------
 * Why the webhook uses a custom content type
 * ---------------------------------------------------------------------------
 * A signature is only meaningful over the EXACT bytes the sender signed.
 * Re-serialising a parsed object (JSON.stringify(req.body)) does not reproduce
 * them — key order, whitespace and unicode escaping all differ — so verifying
 * against a re-serialised body silently accepts payloads it should reject.
 *
 * app.js installs `express.json()` globally at line 35, before any router
 * mounts, and that consumes the request stream. Normally you would fix this with
 * `express.json({ verify })` to stash the raw buffer, but app.js is off-limits
 * beyond a single mount line.
 *
 * So the webhook declares `Content-Type: application/agent-runner+json`, which
 * the global JSON parser does not claim. The stream reaches this router intact
 * and `express.raw()` hands us the exact bytes.
 *
 * If a caller sends `application/json` the body arrives already parsed, the raw
 * bytes are unrecoverable, and we REJECT with 415 rather than fall back to a
 * weaker check. Failing loudly beats verifying something the sender did not sign.
 */

const SIGNATURE_HEADER = "x-agentrunner-signature";
const TIMESTAMP_HEADER = "x-agentrunner-timestamp";
const IDEMPOTENCY_HEADER = "x-agentrunner-idempotency-key";
const SIGNATURE_VERSION = "v1";

/**
 * Compute the expected signature for a delivery.
 *
 * The timestamp is inside the signed material, so an attacker cannot replay a
 * captured body under a fresh timestamp to defeat the freshness window.
 * @param {string} secret - Shared secret.
 * @param {string} timestamp - Unix seconds as sent by the caller.
 * @param {Buffer|string} rawBody - Exact request bytes.
 * @returns {string} Hex-encoded HMAC-SHA256.
 */
function computeSignature(secret, timestamp, rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  return crypto
    .createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION}:${timestamp}:`)
    .update(body)
    .digest("hex");
}

/**
 * Constant-time signature comparison.
 *
 * `timingSafeEqual` throws on length mismatch, and comparing lengths first would
 * itself leak, so both sides are hashed to a fixed 32 bytes before comparison.
 * @param {string} a - First value.
 * @param {string} b - Second value.
 * @returns {boolean} True when equal.
 */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Express middleware verifying the webhook signature and freshness.
 *
 * On success attaches `req.webhook = { idempotencyKey, payload }`.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @param {import("express").NextFunction} next - Express next.
 * @returns {void}
 */
function verifyHmac(req, res, next) {
  if (!config.webhook.secret) {
    return next(
      new AppError(
        "Webhook secret not configured. Set AGENT_RUNNER_WEBHOOK_SECRET.",
        503,
        "CONFIG_ERROR"
      )
    );
  }

  // express.raw() yields a Buffer. Anything else means the global JSON parser
  // claimed the body and the signed bytes are gone.
  if (!Buffer.isBuffer(req.body)) {
    return next(
      new AppError(
        "Webhook must be sent with Content-Type: application/agent-runner+json so the " +
          "raw body can be verified against the signature.",
        415,
        "INVALID_CONTENT_TYPE"
      )
    );
  }

  const signature = req.get(SIGNATURE_HEADER) || "";
  const timestamp = req.get(TIMESTAMP_HEADER) || "";

  if (!signature || !timestamp) {
    return next(new AppError("Missing webhook signature headers", 401, "UNAUTHORIZED"));
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return next(new AppError("Invalid webhook timestamp", 401, "UNAUTHORIZED"));
  }

  // Freshness window bounds how long a captured delivery stays replayable. The
  // idempotency key handles duplicates inside the window.
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > config.webhook.toleranceSec) {
    return next(new AppError("Webhook timestamp outside tolerance", 401, "UNAUTHORIZED"));
  }

  const provided = signature.startsWith(`${SIGNATURE_VERSION}=`)
    ? signature.slice(SIGNATURE_VERSION.length + 1)
    : signature;
  const expected = computeSignature(config.webhook.secret, timestamp, req.body);

  if (!safeEqual(provided, expected)) {
    logger.warn({
      message: "Agent runner webhook signature rejected",
      taskId: req.params.taskId
    });
    return next(new AppError("Invalid webhook signature", 401, "UNAUTHORIZED"));
  }

  let payload = {};
  const text = req.body.toString("utf8");
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      return next(new AppError("Webhook body is not valid JSON", 400, "INVALID_REQUEST"));
    }
  }

  // Prefer the caller's explicit key; otherwise derive one from the signature so
  // an identical redelivery is still recognised as a duplicate.
  const idempotencyKey =
    req.get(IDEMPOTENCY_HEADER) || `sig:${expected.slice(0, 32)}`;

  req.webhook = { idempotencyKey, payload };
  return next();
}

module.exports = {
  verifyHmac,
  computeSignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  IDEMPOTENCY_HEADER,
  SIGNATURE_VERSION
};
