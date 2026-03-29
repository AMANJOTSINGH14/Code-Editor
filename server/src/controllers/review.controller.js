const asyncHandler = require("../utils/asyncHandler");
const { runReview, streamReview } = require("../services/review.service");
const ReviewHistory = require("../models/ReviewHistory");
const AppError = require("../utils/AppError");
const { getDocumentById } = require("../services/document.service");

/**
 * Stream review response via SSE.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const stream = asyncHandler(async (req, res) => {
  const documentId = req.query.documentId;
  if (!documentId) {
    throw new AppError("Missing documentId", 400, "INVALID_REQUEST");
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  await streamReview(documentId, req.user.id, res);
});

/**
 * Run a non-streaming review.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const create = asyncHandler(async (req, res) => {
  const documentId = req.body.documentId;
  if (!documentId) {
    throw new AppError("Missing documentId", 400, "INVALID_REQUEST");
  }

  const result = await runReview(documentId, req.user.id);
  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * List review history for a document.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const history = asyncHandler(async (req, res) => {
  const documentId = req.query.documentId;
  if (!documentId) {
    throw new AppError("Missing documentId", 400, "INVALID_REQUEST");
  }

  await getDocumentById(documentId, req.user.id);

  const reviews = await ReviewHistory.find({ documentId, userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(20);

  res.status(200).json({
    success: true,
    data: {
      reviews: reviews.map((review) => review.toSummary())
    }
  });
});

module.exports = {
  stream,
  create,
  history
};
