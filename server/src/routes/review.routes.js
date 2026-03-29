const express = require("express");
const { z } = require("zod");
const authenticate = require("../middleware/auth");
const validate = require("../middleware/validate");
const { createRateLimiter } = require("../middleware/rateLimiter");
const config = require("../config");
const { stream, create, history } = require("../controllers/review.controller");

const router = express.Router();

router.use(authenticate);

/**
 * Resolve the review rate limit key.
 * @param {import("express").Request} req - Express request.
 * @returns {string} Rate limit key.
 */
function resolveReviewKey(req) {
  return `user:${req.user.id}`;
}

const reviewLimiter = createRateLimiter({
  keyPrefix: `${config.redisPrefix}:review`,
  windowMs: 60 * 60 * 1000,
  max: config.rateLimits.reviewsPerHour,
  keyResolver: resolveReviewKey
});

const createSchema = z.object({
  body: z.object({
    documentId: z.string().min(1)
  }),
  params: z.object({}),
  query: z.object({})
});

const historySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    documentId: z.string().min(1)
  })
});

router.get("/stream", reviewLimiter, stream);
router.post("/", reviewLimiter, validate(createSchema), create);
router.get("/history", validate(historySchema), history);

module.exports = router;
