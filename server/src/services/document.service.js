const mongoose = require("mongoose");
const Document = require("../models/Document");
const User = require("../models/User");
const Version = require("../models/Version");
const ReviewHistory = require("../models/ReviewHistory");
const AppError = require("../utils/AppError");
const { emitRoomEvent, getRoomSockets } = require("../socket/emitter");
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

    emitRoomEvent(roomId, "room:visibility", {
      documentId: roomId,
      isPublic: document.isPublic
    });

    if (!document.isPublic) {
      const sockets = await getRoomSockets(roomId);
      const unauthorizedSockets = sockets.filter((socket) => {
        const socketUserId = socket.user && socket.user.id;
        return !socketUserId || !canAccessDocument(document, socketUserId);
      });

      if (unauthorizedSockets.length > 0) {
        const socketIds = unauthorizedSockets.map((socket) => socket.id);
        const roomKey = `${config.redisPrefix}:room:${roomId}:presence`;

        if (redis.isRedisReady() && redis.redisClient) {
          await redis.redisClient.hdel(roomKey, ...socketIds);
        }

        unauthorizedSockets.forEach((socket) => {
          socket.leave(roomId);
          socket.emit("room:kicked", { documentId: roomId, reason: "ROOM_PRIVATE" });
        });

        if (redis.isRedisReady() && redis.redisClient) {
          const entries = await redis.redisClient.hgetall(roomKey);
          const users = Object.values(entries).map((value) => JSON.parse(value));
          emitRoomEvent(roomId, "presence:update", { documentId: roomId, users });
        }
      }
    }
  }

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
  listContributors,
  updateDocument,
  deleteDocument
};
