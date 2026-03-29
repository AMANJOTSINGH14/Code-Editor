const mongoose = require("mongoose");
const Document = require("../models/Document");
const Version = require("../models/Version");
const ReviewHistory = require("../models/ReviewHistory");
const AppError = require("../utils/AppError");
const redis = require("../config/redis");
const config = require("../config");

/**
 * Determine if a user can access a document.
 * @param {Object} document - Document object.
 * @param {string} userId - User identifier.
 * @returns {boolean} True when access is allowed.
 */
function canAccessDocument(document, userId) {
  if (!document) {
    return false;
  }
  if (document.isPublic) {
    return true;
  }
  if (document.owner.toString() === userId) {
    return true;
  }
  return document.collaborators.some((collaborator) => collaborator.toString() === userId);
}

/**
 * Create a new document.
 * @param {Object} payload - Document data.
 * @param {string} payload.title - Document title.
 * @param {string} payload.language - Document language.
 * @param {string} payload.ownerId - Owner user ID.
 * @param {boolean} payload.isPublic - Public flag.
 * @returns {Promise<Object>} Created document.
 */
async function createDocument({ title, language, ownerId, isPublic }) {
  const docId = new mongoose.Types.ObjectId();
  const document = await Document.create({
    _id: docId,
    title,
    language,
    roomId: docId.toString(),
    owner: ownerId,
    isPublic: Boolean(isPublic),
    collaborators: []
  });

  if (redis.isRedisReady() && redis.redisClient) {
    await redis.redisClient.del(`${config.redisPrefix}:docs:meta:${ownerId}`);
  }

  return document;
}

/**
 * List accessible documents for a user.
 * @param {string} userId - User ID.
 * @returns {Promise<Array<Object>>} Document metadata list.
 */
async function listDocuments(userId) {
  const cacheKey = `${config.redisPrefix}:docs:meta:${userId}`;

  if (redis.isRedisReady() && redis.redisClient) {
    const cached = await redis.redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const documents = await Document.find({
    $or: [{ owner: userId }, { collaborators: userId }, { isPublic: true }]
  }).sort({ updatedAt: -1 });

  const metadata = documents.map((doc) => doc.toMeta());

  if (redis.isRedisReady() && redis.redisClient) {
    await redis.redisClient.setex(cacheKey, config.cacheTtlSeconds, JSON.stringify(metadata));
  }

  return metadata;
}

/**
 * Get a document by id with permission check.
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @returns {Promise<Object>} Document.
 */
async function getDocumentById(documentId, userId) {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    throw new AppError("Invalid document id", 400, "INVALID_ID");
  }

  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }

  if (!canAccessDocument(document, userId)) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  return document;
}

/**
 * Update a document.
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @param {Object} updates - Document updates.
 * @returns {Promise<Object>} Updated document.
 */
async function updateDocument(documentId, userId, updates) {
  const document = await getDocumentById(documentId, userId);
  const isOwner = document.owner.toString() === userId;

  if (typeof updates.title === "string") {
    if (!isOwner) throw new AppError("Only the owner can rename", 403, "FORBIDDEN");
    document.title = updates.title;
  }
  if (typeof updates.language === "string") {
    document.language = updates.language;
  }
  if (typeof updates.isPublic === "boolean") {
    if (!isOwner) throw new AppError("Only the owner can change visibility", 403, "FORBIDDEN");
    document.isPublic = updates.isPublic;
  }

  await document.save();

  if (redis.isRedisReady() && redis.redisClient) {
    await redis.redisClient.del(`${config.redisPrefix}:docs:meta:${userId}`);
  }

  return document;
}

/**
 * Delete a document and related data.
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @returns {Promise<void>} Resolves when deleted.
 */
async function deleteDocument(documentId, userId) {
  const document = await getDocumentById(documentId, userId);
  if (document.owner.toString() !== userId) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  await Document.deleteOne({ _id: documentId });
  await Version.deleteMany({ documentId });
  await ReviewHistory.deleteMany({ documentId });

  if (redis.isRedisReady() && redis.redisClient) {
    await redis.redisClient.del(`${config.redisPrefix}:docs:meta:${userId}`);
  }
}

module.exports = {
  canAccessDocument,
  createDocument,
  listDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument
};
