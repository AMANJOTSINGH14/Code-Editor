const mongoose = require("mongoose");
const Document = require("../models/Document");
const User = require("../models/User");
const Version = require("../models/Version");
const ReviewHistory = require("../models/ReviewHistory");
const AppError = require("../utils/AppError");
const { emitRoomEvent, getLocalRoomSockets } = require("../socket/emitter");
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
 * Invalidate the cached document list for one user.
 * @param {string} userId - User ID.
 * @returns {Promise<void>} Resolves when cleared.
 */
async function invalidateUserDocsCache(userId) {
  if (redis.isRedisReady() && redis.redisClient) {
    await redis.redisClient.del(`${config.redisPrefix}:docs:meta:${userId}`);
  }
}

/**
 * Invalidate cached document lists for the owner and every collaborator.
 * @param {Object} document - Document object.
 * @returns {Promise<void>} Resolves when cleared.
 */
async function invalidateDocListCaches(document) {
  const ids = new Set([document.owner.toString()]);
  (document.collaborators || []).forEach((collaborator) => {
    if (collaborator) {
      ids.add(collaborator.toString());
    }
  });
  await Promise.all(Array.from(ids).map((id) => invalidateUserDocsCache(id)));
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

  await invalidateUserDocsCache(ownerId);

  return document;
}

/**
 * List a user's own documents (owned or shared with them).
 * Public documents owned by others are reachable by link but are not listed
 * here, so the dashboard only shows the user's own rooms.
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
    $or: [{ owner: userId }, { collaborators: userId }]
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
 * Open a document for viewing/editing. Access is strict: only the owner,
 * collaborators, or anyone while the doc is public. Private docs are not
 * joinable by others (and connected non-members are kicked on going private).
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @returns {Promise<Object>} Document.
 */
async function openDocument(documentId, userId) {
  return getDocumentById(documentId, userId);
}

/**
 * List contributors for a document.
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @returns {Promise<Array<{id: string, name: string, email: string}>>} Contributors list.
 */
async function listContributors(documentId, userId) {
  const document = await getDocumentById(documentId, userId);
  const contributorIds = new Set();

  if (document.owner) {
    contributorIds.add(document.owner.toString());
  }

  (document.collaborators || []).forEach((collaborator) => {
    if (collaborator) {
      contributorIds.add(collaborator.toString());
    }
  });

  const docId = document._id.toString();
  const versionUsers = await Version.distinct("createdBy", { documentId: docId });
  versionUsers.forEach((id) => contributorIds.add(id.toString()));

  const reviewUsers = await ReviewHistory.distinct("userId", { documentId: docId });
  reviewUsers.forEach((id) => contributorIds.add(id.toString()));

  const ids = Array.from(contributorIds);
  if (ids.length === 0) {
    return [];
  }

  const contributors = await User.find({ _id: { $in: ids } })
    .select("name email")
    .sort({ email: 1 })
    .lean();

  return contributors.map((entry) => ({
    id: entry._id.toString(),
    name: entry.name || "",
    email: entry.email || ""
  }));
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
  const wasPublic = document.isPublic;

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

  if (typeof updates.isPublic === "boolean" && wasPublic !== document.isPublic) {
    const roomId = document._id.toString();

    // Tell connected clients the visibility changed (refresh badge / access).
    emitRoomEvent(roomId, "room:visibility", {
      documentId: roomId,
      isPublic: document.isPublic
    });

    // When a room becomes private, kick out anyone connected who is no longer
    // allowed in (not the owner and not a collaborator).
    if (!document.isPublic) {
      getLocalRoomSockets(roomId).forEach((socket) => {
        const socketUserId = socket.user && socket.user.id;
        if (!socketUserId || !canAccessDocument(document, socketUserId)) {
          socket.leave(roomId);
          socket.emit("room:kicked", { documentId: roomId, reason: "ROOM_PRIVATE" });
        }
      });
    }
  }

  // Visibility/title/language changes affect the dashboard for the owner and
  // every collaborator, so clear all of their cached lists.
  await invalidateDocListCaches(document);

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

  await invalidateDocListCaches(document);
}

module.exports = {
  canAccessDocument,
  createDocument,
  listDocuments,
  getDocumentById,
  openDocument,
  listContributors,
  updateDocument,
  deleteDocument
};
