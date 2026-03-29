const mongoose = require("mongoose");
const Document = require("../models/Document");
const AppError = require("../utils/AppError");
const { canAccessDocument } = require("../services/document.service");
const {
  encodeStateAsUpdate,
  encodeFullAwareness,
  trackSocketJoin,
  trackSocketLeave,
  getOrCreateRoom
} = require("../services/crdt.service");
const redis = require("../config/redis");
const config = require("../config");

const presenceFallback = new Map();

/**
 * Add a user presence to the room store.
 * @param {string} documentId - Document id.
 * @param {string} socketId - Socket id.
 * @param {Object} user - User payload.
 * @returns {Promise<Array<Object>>} Presence list.
 */
async function addPresence(documentId, socketId, user) {
  const presence = {
    id: user.id,
    name: user.name,
    email: user.email,
    socketId
  };

  if (redis.isRedisReady() && redis.redisClient) {
    const roomKey = `${config.redisPrefix}:room:${documentId}:presence`;
    await redis.redisClient.hset(roomKey, socketId, JSON.stringify(presence));
    await redis.redisClient.expire(roomKey, 60 * 60);
    await redis.redisClient.setex(`${config.redisPrefix}:user:${user.id}:room`, 60 * 60, documentId);

    const entries = await redis.redisClient.hgetall(roomKey);
    return Object.values(entries).map((value) => JSON.parse(value));
  }

  const roomPresence = presenceFallback.get(documentId) || new Map();
  roomPresence.set(socketId, presence);
  presenceFallback.set(documentId, roomPresence);
  return Array.from(roomPresence.values());
}

/**
 * Remove a user presence from the room store.
 * @param {string} documentId - Document id.
 * @param {string} socketId - Socket id.
 * @returns {Promise<Array<Object>>} Presence list.
 */
async function removePresence(documentId, socketId) {
  if (redis.isRedisReady() && redis.redisClient) {
    const roomKey = `${config.redisPrefix}:room:${documentId}:presence`;
    await redis.redisClient.hdel(roomKey, socketId);
    const entries = await redis.redisClient.hgetall(roomKey);
    return Object.values(entries).map((value) => JSON.parse(value));
  }

  const roomPresence = presenceFallback.get(documentId);
  if (!roomPresence) {
    return [];
  }
  roomPresence.delete(socketId);
  if (roomPresence.size === 0) {
    presenceFallback.delete(documentId);
  }
  return Array.from(roomPresence.values());
}

/**
 * Get a document or create a blank one if missing.
 * @param {string} documentId - Document id.
 * @param {Object} user - User payload.
 * @returns {Promise<Object>} Document.
 */
async function ensureDocument(documentId, user) {
  if (!mongoose.Types.ObjectId.isValid(documentId)) {
    throw new AppError("Invalid document id", 400, "INVALID_ID");
  }

  let document = await Document.findById(documentId);
  if (!document) {
    try {
      document = await Document.create({
        _id: documentId,
        title: "Untitled",
        language: "javascript",
        roomId: documentId,
        owner: user.id,
        collaborators: [],
        isPublic: false,
        content: null,
        snapshotText: ""
      });
    } catch (error) {
      if (error && error.code === 11000) {
        document = await Document.findById(documentId);
      } else {
        throw error;
      }
    }
  }

  if (!canAccessDocument(document, user.id)) {
    throw new AppError("Forbidden", 403, "FORBIDDEN");
  }

  return document;
}

/**
 * Register room-related socket handlers.
 * @param {import("socket.io").Server} io - Socket.io server.
 * @param {import("socket.io").Socket} socket - Socket instance.
 * @param {Function} wrap - Error wrapper.
 * @returns {void}
 */
function registerRoomHandlers(io, socket, wrap) {
  socket.on(
    "room:join",
    wrap(async ({ documentId }) => {
      const document = await ensureDocument(documentId, socket.user);
      await getOrCreateRoom(document._id.toString());
      socket.join(documentId);
      await trackSocketJoin(documentId, socket.id);

      const update = await encodeStateAsUpdate(documentId);
      const awareness = await encodeFullAwareness(documentId);
      const presence = await addPresence(documentId, socket.id, socket.user);

      socket.emit("sync:full", {
        documentId,
        update: Buffer.from(update).toString("base64"),
        awareness: Buffer.from(awareness).toString("base64")
      });

      io.to(documentId).emit("presence:update", {
        documentId,
        users: presence
      });
    })
  );

  socket.on(
    "room:leave",
    wrap(async ({ documentId }) => {
      socket.leave(documentId);
      await trackSocketLeave(documentId, socket.id);
      const presence = await removePresence(documentId, socket.id);
      io.to(documentId).emit("presence:update", {
        documentId,
        users: presence
      });
    })
  );

  socket.on(
    "disconnect",
    wrap(async () => {
      const rooms = Array.from(socket.rooms).filter((room) => room !== socket.id);
      await Promise.all(
        rooms.map(async (documentId) => {
          await trackSocketLeave(documentId, socket.id);
          const presence = await removePresence(documentId, socket.id);
          io.to(documentId).emit("presence:update", {
            documentId,
            users: presence
          });
        })
      );
    })
  );
}

module.exports = {
  registerRoomHandlers
};
