const asyncHandler = require("../utils/asyncHandler");
const {
  createDocument,
  listDocuments,
  openDocument,
  listContributors,
  updateDocument,
  deleteDocument
} = require("../services/document.service");

/**
 * Create a new document.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const create = asyncHandler(async (req, res) => {
  const document = await createDocument({
    title: req.body.title,
    language: req.body.language,
    ownerId: req.user.id,
    isPublic: req.body.isPublic
  });

  res.status(201).json({
    success: true,
    data: {
      document: document.toMeta()
    }
  });
});

/**
 * List documents for the current user.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const list = asyncHandler(async (req, res) => {
  const documents = await listDocuments(req.user.id);
  res.status(200).json({
    success: true,
    data: {
      documents
    }
  });
});

/**
 * Get a document by id.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const get = asyncHandler(async (req, res) => {
  const document = await openDocument(req.params.id, req.user.id);
  res.status(200).json({
    success: true,
    data: {
      document: document.toMeta(),
      snapshotText: document.snapshotText
    }
  });
});

/**
 * List contributors for a document.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const contributors = asyncHandler(async (req, res) => {
  const contributorsList = await listContributors(req.params.id, req.user.id);
  res.status(200).json({
    success: true,
    data: {
      contributors: contributorsList
    }
  });
});

/**
 * Update a document.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const update = asyncHandler(async (req, res) => {
  const document = await updateDocument(req.params.id, req.user.id, req.body);
  res.status(200).json({
    success: true,
    data: {
      document: document.toMeta()
    }
  });
});

/**
 * Delete a document.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Response promise.
 */
const remove = asyncHandler(async (req, res) => {
  await deleteDocument(req.params.id, req.user.id);
  res.status(204).send();
});

module.exports = {
  create,
  list,
  get,
  contributors,
  update,
  remove
};
