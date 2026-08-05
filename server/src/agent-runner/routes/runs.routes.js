const express = require("express");
const authenticate = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rateLimiter");
const appConfig = require("../../config");
const { verifyHmac } = require("../middleware/hmac");
const {
  triggerWebhook,
  createRun,
  list,
  get,
  listTasks,
  stream,
  downloadArtifact,
  executeCode,
  runtimes,
  verifyFix
} = require("../controllers/runs.controller");

const router = express.Router();

// The webhook is unauthenticated by design — it is authorised by its HMAC
// signature, not by a JWT — so it carries its own IP-keyed rate limit. Without
// one, an attacker who cannot forge a signature could still force unbounded
// signature verifications.
const webhookLimiter = createRateLimiter({
  keyPrefix: `${appConfig.redisPrefix}:agentrunner:webhook`,
  windowMs: 60 * 1000,
  max: 30
});

/**
 * Webhook trigger.
 *
 * `express.raw` must run before `verifyHmac`: the signature is computed over the
 * exact request bytes, and this is the only place they are still available. See
 * middleware/hmac.js for why the custom content type is required.
 */
router.post(
  "/trigger/:taskId",
  webhookLimiter,
  express.raw({ type: "*/*", limit: "1mb" }),
  verifyHmac,
  triggerWebhook
);

// Everything below requires a JWT. Declared after the webhook so the webhook is
// never subjected to it.
router.use(authenticate);

const manualLimiter = createRateLimiter({
  keyPrefix: `${appConfig.redisPrefix}:agentrunner:manual`,
  windowMs: 60 * 1000,
  max: 10,
  keyResolver: (req) => `user:${req.user.id}`
});

// Ad-hoc execution is cheap (no Gemini) but not free — each call is a container.
// A dedicated, looser limit than the agent-run limiter: a developer iterating in
// the editor will legitimately hit Run far more often than they trigger agents.
const executeLimiter = createRateLimiter({
  keyPrefix: `${appConfig.redisPrefix}:agentrunner:execute`,
  windowMs: 60 * 1000,
  max: 30,
  keyResolver: (req) => `user:${req.user.id}`
});

router.post("/", manualLimiter, createRun);
router.get("/", list);
// Declared before "/:id" so literal paths are not captured as run ids.
router.get("/tasks", listTasks);
router.get("/runtimes", runtimes);
router.post("/execute", executeLimiter, executeCode);

// Verify & Fix spends Gemini quota, so it gets the tighter agent-run limit
// rather than the loose ad-hoc execution one.
router.post("/verify-fix", manualLimiter, verifyFix);
router.get("/:id", get);
router.get("/:id/stream", stream);
router.get("/:id/artifacts/:name", downloadArtifact);

module.exports = router;
