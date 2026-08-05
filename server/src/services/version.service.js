const mongoose = require("mongoose");
const Version = require("../models/Version");
const Document = require("../models/Document");
const AppError = require("../utils/AppError");
const config = require("../config");
const { canAccessDocument } = require("./document.service");
const redis = require("../config/redis");

const localPublishGuard = new Map();

/**
 * Get the next version number for a document.
 * @param {string} documentId - Document id.
 * @returns {Promise<number>} Next version number.
 */
async function getNextVersionNumber(documentId) {
  const last = await Version.findOne({ documentId }).sort({ versionNumber: -1 });
  return last ? last.versionNumber + 1 : 1;
}

/**
 * Enforce publish debounce per user.
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @returns {Promise<void>} Resolves if allowed.
 */
async function assertPublishAllowed(documentId, userId) {
  const key = `${config.redisPrefix}:version:publish:${documentId}:${userId}`;
  const now = Date.now();

  if (redis.isRedisReady() && redis.redisClient) {
    const result = await redis.redisClient.set(key, `${now}`, "PX", 10000, "NX");
    if (!result) {
      throw new AppError("Please wait before saving again", 429, "RATE_LIMIT");
    }
    return;
  }

  const last = localPublishGuard.get(key) || 0;
  if (now - last < 10000) {
    throw new AppError("Please wait before saving again", 429, "RATE_LIMIT");
  }
  localPublishGuard.set(key, now);
}

/**
 * Create an auto-save version.
 * @param {Object} payload - Auto-save payload.
 * @param {string} payload.documentId - Document id.
 * @param {Buffer} payload.content - Yjs update buffer.
 * @param {string} payload.snapshotText - Plain text snapshot.
 * @param {string} payload.userId - User id.
 * @returns {Promise<Version>} Created version.
 */
async function createAutoSaveVersion({ documentId, content, snapshotText, userId }) {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    throw new AppError("Invalid document id", 400, "INVALID_ID");
  }

  const versionNumber = await getNextVersionNumber(documentId);
  const label = `Auto-save #${versionNumber}`;

  const version = await Version.create({
    documentId,
    versionNumber,
    label,
    content,
    snapshotText,
    createdBy: userId,
    isPublished: false,
    isAutoSave: true
  });

  const autoSaves = await Version.find({ documentId, isAutoSave: true }).sort({ createdAt: -1 });
  if (autoSaves.length > config.yjs.autoSaveLimit) {
    const toDelete = autoSaves.slice(config.yjs.autoSaveLimit);
    const ids = toDelete.map((item) => item._id);
    await Version.deleteMany({ _id: { $in: ids } });
  }

  return version;
}

/**
 * Create a published version.
 * @param {Object} payload - Publish payload.
 * @param {string} payload.documentId - Document id.
 * @param {string} payload.label - Version label.
 * @param {string} payload.userId - User id.
 * @returns {Promise<Version>} Created version.
 */
async function createPublishedVersion({ documentId, label, userId }) {
  await assertPublishAllowed(documentId, userId);

  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }

  if (!canAccessDocument(document, userId)) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  const versionNumber = await getNextVersionNumber(documentId);
  const content = document.content && document.content.length > 0
    ? document.content
    : Buffer.from(new Uint8Array([0]));
  const snapshotText = document.snapshotText || "";

  const version = await Version.create({
    documentId,
    versionNumber,
    label: label || `Version ${versionNumber}`,
    content,
    snapshotText,
    createdBy: userId,
    isPublished: true,
    isAutoSave: false
  });

  return Version.findById(version._id).populate("createdBy", "name");
}

/**
 * List versions for a document.
 * @param {Object} payload - List payload.
 * @param {string} payload.documentId - Document id.
 * @param {string} payload.userId - User id.
 * @param {number} payload.page - Page number.
 * @param {number} payload.limit - Page size.
 * @returns {Promise<{items: Array<Object>, total: number}>} Version list.
 */
async function listVersions({ documentId, userId, page, limit }) {
  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }

  if (!canAccessDocument(document, userId)) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  const total = await Version.countDocuments({ documentId });
  const versions = await Version.find({ documentId })
    .populate("createdBy", "name")
    .sort({ createdAt: -1, versionNumber: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return {
    items: versions.map((version) => version.toSummary()),
    total
  };
}

/**
 * Get a specific version content.
 * @param {string} documentId - Document id.
 * @param {string} versionId - Version id.
 * @param {string} userId - User id.
 * @returns {Promise<Version>} Version document.
 */
async function getVersion(documentId, versionId, userId) {
  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }
  if (!canAccessDocument(document, userId)) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  const version = await Version.findById(versionId).populate("createdBy", "name");
  if (!version) {
    throw new AppError("Version not found", 404, "NOT_FOUND");
  }

  return version;
}

/**
 * Restore a version and create a backup version.
 * @param {Object} payload - Restore payload.
 * @param {string} payload.documentId - Document id.
 * @param {string} payload.versionId - Version id.
 * @param {string} payload.userId - User id.
 * @returns {Promise<{restored: Version, backup: Version}>} Restore result.
 */
async function restoreVersion({ documentId, versionId, userId }) {
  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }
  if (!canAccessDocument(document, userId)) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  const version = await Version.findById(versionId);
  if (!version) {
    throw new AppError("Version not found", 404, "NOT_FOUND");
  }

  const backupNumber = await getNextVersionNumber(documentId);
  const backupLabel = `Restored from: ${version.label}`;

  const backupDoc = await Version.create({
    documentId,
    versionNumber: backupNumber,
    label: backupLabel,
    content: document.content && document.content.length > 0
      ? document.content
      : Buffer.from(new Uint8Array([0])),
    snapshotText: document.snapshotText || "",
    createdBy: userId,
    isPublished: true,
    isAutoSave: false
  });

  document.content = version.content;
  document.snapshotText = version.snapshotText;
  await document.save();

  const populatedVersion = await Version.findById(version._id).populate("createdBy", "name");
  const populatedBackup = await Version.findById(backupDoc._id).populate("createdBy", "name");

  return { restored: populatedVersion, backup: populatedBackup };
}

/**
 * Delete an auto-save version.
 * @param {Object} payload - Delete payload.
 * @param {string} payload.documentId - Document id.
 * @param {string} payload.versionId - Version id.
 * @param {string} payload.userId - User id.
 * @returns {Promise<void>} Resolves when deleted.
 */
async function deleteVersion({ documentId, versionId, userId }) {
  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }
  if (document.owner.toString() !== userId) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  const version = await Version.findById(versionId);
  if (!version) {
    throw new AppError("Version not found", 404, "NOT_FOUND");
  }

  if (version.isPublished) {
    throw new AppError("Cannot delete published version", 403, "FORBIDDEN");
  }

  if (version.documentId.toString() !== documentId) {
    throw new AppError("Version does not belong to document", 400, "INVALID_REQUEST");
  }

  await Version.deleteOne({ _id: versionId });
}

module.exports = {
  createAutoSaveVersion,
  createPublishedVersion,
  listVersions,
  getVersion,
  restoreVersion,
  deleteVersion
};
