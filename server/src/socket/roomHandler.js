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
 * Resolve active socket ids for a room.
 * @param {import("socket.io").Server} io - Socket.io server.
 * @param {string} documentId - Document id.
 * @returns {Promise<Set<string>|null>} Active socket ids or null on failure.
 */
async function getActiveSocketIds(io, documentId) {
  try {
    return await io.in(documentId).allSockets();
  } catch {
    return null;
  }
}

/**
 * Filter presence entries by active socket ids.
 * @param {Array<Object>} presence - Presence list.
 * @param {Set<string>|null} activeSocketIds - Active socket ids.
 * @returns {Array<Object>} Filtered presence list.
 */
function filterPresenceBySockets(presence, activeSocketIds) {
  if (!activeSocketIds) {
    return presence || [];
  }
  if (activeSocketIds.size === 0) {
    return [];
  }
  return (presence || []).filter((entry) => entry?.socketId && activeSocketIds.has(entry.socketId));
}

/**
 * Add a user presence to the room store.
 * @param {string} documentId - Document id.
 * @param {string} socketId - Socket id.
 * @param {Object} user - User payload.
 * @param {Set<string>|null} activeSocketIds - Active socket ids.
 * @returns {Promise<Array<Object>>} Presence list.
 */
async function addPresence(documentId, socketId, user, activeSocketIds) {
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
    if (activeSocketIds && activeSocketIds.size > 0) {
      const staleSocketIds = Object.keys(entries).filter((entrySocketId) => !activeSocketIds.has(entrySocketId));
      if (staleSocketIds.length > 0) {
        await redis.redisClient.hdel(roomKey, ...staleSocketIds);
        staleSocketIds.forEach((entrySocketId) => {
          delete entries[entrySocketId];
        });
      }
    }
    return Object.values(entries).map((value) => JSON.parse(value));
  }

  const roomPresence = presenceFallback.get(documentId) || new Map();
  roomPresence.set(socketId, presence);
  if (activeSocketIds && activeSocketIds.size > 0) {
    Array.from(roomPresence.keys()).forEach((entrySocketId) => {
      if (!activeSocketIds.has(entrySocketId)) {
        roomPresence.delete(entrySocketId);
      }
    });
  }
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
      return document;
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

      const activeSocketIds = await getActiveSocketIds(io, documentId);

      const update = await encodeStateAsUpdate(documentId);
      const awareness = await encodeFullAwareness(documentId);
      const presence = await addPresence(documentId, socket.id, socket.user, activeSocketIds);
      const filteredPresence = filterPresenceBySockets(presence, activeSocketIds);

      socket.emit("sync:full", {
        documentId,
        update: Buffer.from(update).toString("base64"),
        awareness: Buffer.from(awareness).toString("base64")
      });

      io.to(documentId).emit("presence:update", {
        documentId,
        users: filteredPresence
      });
    })
  );

  socket.on(
    "room:leave",
    wrap(async ({ documentId }) => {
      socket.leave(documentId);
      await trackSocketLeave(documentId, socket.id);
      const presence = await removePresence(documentId, socket.id);
      const activeSocketIds = await getActiveSocketIds(io, documentId);
      const filteredPresence = filterPresenceBySockets(presence, activeSocketIds);
      io.to(documentId).emit("presence:update", {
        documentId,
        users: filteredPresence
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
          const activeSocketIds = await getActiveSocketIds(io, documentId);
          const filteredPresence = filterPresenceBySockets(presence, activeSocketIds);
          io.to(documentId).emit("presence:update", {
            documentId,
            users: filteredPresence
          });
        })
      );
    })
  );
}

module.exports = {
  registerRoomHandlers
};
