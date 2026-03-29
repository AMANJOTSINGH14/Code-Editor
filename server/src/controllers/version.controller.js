const asyncHandler = require("../utils/asyncHandler");
const {
  createPublishedVersion,
  listVersions,
  getVersion,
  restoreVersion,
  deleteVersion
} = require("../services/version.service");
const { replaceRoomContent } = require("../services/crdt.service");
const { emitRoomEvent } = require("../socket/emitter");

/**
 * Create a published version.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const create = asyncHandler(async (req, res) => {
  const version = await createPublishedVersion({
    documentId: req.params.id,
    label: req.body.label,
    userId: req.user.id
  });

  res.status(201).json({
    success: true,
    data: {
      version: version.toSummary()
    }
  });
});

/**
 * List versions for a document.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const list = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const result = await listVersions({
    documentId: req.params.id,
    userId: req.user.id,
    page,
    limit
  });

  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * Get a specific version content.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const get = asyncHandler(async (req, res) => {
  const version = await getVersion(req.params.id, req.params.versionId, req.user.id);
  res.status(200).json({
    success: true,
    data: {
      version: version.toSummary(),
      content: version.content.toString("base64")
    }
  });
});

/**
 * Restore a version and broadcast to collaborators.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const restore = asyncHandler(async (req, res) => {
  const result = await restoreVersion({
    documentId: req.params.id,
    versionId: req.params.versionId,
    userId: req.user.id
  });

  await replaceRoomContent({
    documentId: req.params.id,
    content: result.restored.content,
    snapshotText: result.restored.snapshotText,
    actor: req.user
  });

  emitRoomEvent(req.params.id, "doc:restored", {
    label: result.restored.label,
    user: req.user
  });

  res.status(200).json({
    success: true,
    data: {
      restored: result.restored.toSummary(),
      backup: result.backup.toSummary()
    }
  });
});

/**
 * Delete an auto-save version.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const remove = asyncHandler(async (req, res) => {
  await deleteVersion({
    documentId: req.params.id,
    versionId: req.params.versionId,
    userId: req.user.id
  });

  res.status(204).send();
});

module.exports = {
  create,
  list,
  get,
  restore,
  remove
};
