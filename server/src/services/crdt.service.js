const Y = require("yjs");
const { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } = require("y-protocols/awareness");
const Document = require("../models/Document");
const AppError = require("../utils/AppError");
const config = require("../config");
const logger = require("../utils/logger");
const { getRedlock } = require("../config/redis");
const { createAutoSaveVersion } = require("./version.service");
const { emitRoomEvent } = require("../socket/emitter");

const rooms = new Map();

/**
 * Create a Yjs document instance.
 * @returns {Y.Doc} New Yjs document.
 */
function createYDoc() {
  const doc = new Y.Doc();
  doc.getText("content");
  return doc;
}

/**
 * Create a room state for a document.
 * @param {string} documentId - Document id.
 * @returns {Promise<Object>} Room state.
 */
async function createRoom(documentId) {
  const doc = createYDoc();
  const awareness = new Awareness(doc);

  const document = await Document.findById(documentId);
  if (!document) {
    throw new AppError("Document not found", 404, "NOT_FOUND");
  }

  if (document.content && document.content.length > 1) {
    try {
      Y.applyUpdate(doc, new Uint8Array(document.content));
    } catch (error) {
      logger.warn({ message: "Could not apply stored Yjs update, starting fresh", documentId, error: error.message });
      if (document.snapshotText) {
        doc.getText("content").insert(0, document.snapshotText);
      }
    }
  } else if (document.snapshotText) {
    doc.getText("content").insert(0, document.snapshotText);
  }

  const roomState = {
    documentId,
    doc,
    awareness,
    sockets: new Set(),
    lastPersistedAt: 0,
    lastAutoSaveAt: 0,
    persistTimer: null,
    cleanupTimer: null,
    lastEditorId: null,
    retryCount: 0
  };

  doc.on("update", () => {
    schedulePersist(documentId);
  });

  rooms.set(documentId, roomState);
  return roomState;
}

/**
 * Get or create a room state.
 * @param {string} documentId - Document id.
 * @returns {Promise<Object>} Room state.
 */
async function getOrCreateRoom(documentId) {
  if (rooms.has(documentId)) {
    return rooms.get(documentId);
  }
  return createRoom(documentId);
}

/**
 * Apply a Yjs update.
 * @param {Object} payload - Update payload.
 * @param {string} payload.documentId - Document id.
 * @param {Uint8Array} payload.update - Yjs update.
 * @param {string} payload.actorId - User id.
 * @returns {Promise<void>} Resolves when applied.
 */
async function applyUpdate({ documentId, update, actorId }) {
  const room = await getOrCreateRoom(documentId);
  room.lastEditorId = actorId || room.lastEditorId;
  Y.applyUpdate(room.doc, update);
}

/**
 * Apply awareness updates to the room.
 * @param {Object} payload - Awareness payload.
 * @param {string} payload.documentId - Document id.
 * @param {Uint8Array} payload.update - Awareness update.
 * @param {string} payload.origin - Update origin.
 * @returns {Promise<void>} Resolves when applied.
 */
async function applyAwareness({ documentId, update, origin }) {
  const room = await getOrCreateRoom(documentId);
  applyAwarenessUpdate(room.awareness, update, origin);
}

/**
 * Encode current document state as update.
 * @param {string} documentId - Document id.
 * @param {Uint8Array} [stateVector] - Optional state vector.
 * @returns {Promise<Uint8Array>} Yjs update.
 */
async function encodeStateAsUpdate(documentId, stateVector) {
  const room = await getOrCreateRoom(documentId);
  return Y.encodeStateAsUpdate(room.doc, stateVector);
}

/**
 * Encode the awareness state for a set of clients.
 * @param {string} documentId - Document id.
 * @param {Array<number>} clientIds - Awareness client ids.
 * @returns {Promise<Uint8Array>} Awareness update.
 */
async function encodeAwareness(documentId, clientIds) {
  const room = await getOrCreateRoom(documentId);
  return encodeAwarenessUpdate(room.awareness, clientIds);
}

/**
 * Encode full awareness state.
 * @param {string} documentId - Document id.
 * @returns {Promise<Uint8Array>} Awareness update.
 */
async function encodeFullAwareness(documentId) {
  const room = await getOrCreateRoom(documentId);
  const clientIds = Array.from(room.awareness.getStates().keys());
  return encodeAwarenessUpdate(room.awareness, clientIds);
}

/**
 * Track a socket joining a room.
 * @param {string} documentId - Document id.
 * @param {string} socketId - Socket id.
 * @returns {Promise<number>} Current socket count.
 */
async function trackSocketJoin(documentId, socketId) {
  const room = await getOrCreateRoom(documentId);
  room.sockets.add(socketId);
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
  return room.sockets.size;
}

/**
 * Track a socket leaving a room.
 * @param {string} documentId - Document id.
 * @param {string} socketId - Socket id.
 * @returns {Promise<number>} Current socket count.
 */
async function trackSocketLeave(documentId, socketId) {
  const room = rooms.get(documentId);
  if (!room) {
    return 0;
  }
  room.sockets.delete(socketId);
  if (room.sockets.size === 0) {
    room.cleanupTimer = setTimeout(() => {
      persistRoom(documentId).catch((error) => {
        logger.error({ message: "Failed to persist on cleanup", error });
      });
      rooms.delete(documentId);
    }, config.yjs.roomTtlMs);
  }
  return room.sockets.size;
}

/**
 * Schedule persistence based on debounce and max interval.
 * @param {string} documentId - Document id.
 * @returns {void}
 */
function schedulePersist(documentId) {
  const room = rooms.get(documentId);
  if (!room) {
    return;
  }

  const now = Date.now();
  const timeSincePersist = now - room.lastPersistedAt;

  if (timeSincePersist >= config.yjs.persistMaxMs) {
    persistRoom(documentId).catch((error) => {
      logger.error({ message: "Persist failed", error });
    });
    return;
  }

  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
  }

  room.persistTimer = setTimeout(() => {
    persistRoom(documentId).catch((error) => {
      logger.error({ message: "Persist failed", error });
    });
  }, config.yjs.persistDebounceMs);
}

/**
 * Persist a room snapshot to MongoDB and create auto-save.
 * @param {string} documentId - Document id.
 * @returns {Promise<void>} Resolves when persisted.
 */
async function persistRoom(documentId) {
  const room = rooms.get(documentId);
  if (!room) {
    return;
  }

  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
    room.persistTimer = null;
  }

  const redlock = getRedlock();
  const lockKey = `lock:document:${documentId}`;
  let lock = null;

  try {
    if (redlock) {
      lock = await redlock.acquire([lockKey], 2000);
    }

    const update = Y.encodeStateAsUpdate(room.doc);
    const snapshotText = room.doc.getText("content").toString();

    await Document.updateOne(
      { _id: documentId },
      {
        content: Buffer.from(update),
        snapshotText,
        updatedAt: new Date()
      }
    );

    room.lastPersistedAt = Date.now();
    room.retryCount = 0;

    // Persistence runs every few seconds while people type (data safety), but
    // an auto-save VERSION is only cut at most once per autoSaveIntervalMs so
    // the version list doesn't fill up with near-identical snapshots.
    if (
      room.lastEditorId &&
      Date.now() - room.lastAutoSaveAt >= config.yjs.autoSaveIntervalMs
    ) {
      await createAutoSaveVersion({
        documentId,
        content: Buffer.from(update),
        snapshotText,
        userId: room.lastEditorId
      });
      room.lastAutoSaveAt = Date.now();
    }
  } catch (error) {
    room.retryCount += 1;
    const delay = Math.min(1000 * Math.pow(2, room.retryCount), 10000);
    setTimeout(() => {
      persistRoom(documentId).catch((persistError) => {
        logger.error({ message: "Persist retry failed", persistError });
      });
    }, delay);
    logger.error({ message: "Persist failed", error });
  } finally {
    if (lock) {
      await lock.release();
    }
  }
}

/**
 * Replace room content with a snapshot and broadcast update.
 * @param {Object} payload - Replace payload.
 * @param {string} payload.documentId - Document id.
 * @param {Buffer} payload.content - Snapshot update.
 * @param {string} payload.snapshotText - Snapshot text.
 * @param {Object} payload.actor - Actor metadata.
 * @returns {Promise<void>} Resolves when replaced.
 */
async function replaceRoomContent({ documentId, content, snapshotText, actor }) {
  const room = await getOrCreateRoom(documentId);
  const ytext = room.doc.getText("content");
  const stateVector = Y.encodeStateVector(room.doc);

  room.doc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, snapshotText || "");
  });

  const update = Y.encodeStateAsUpdate(room.doc, stateVector);
  room.lastEditorId = actor && actor.id ? actor.id : room.lastEditorId;

  await Document.updateOne(
    { _id: documentId },
    {
      content: content || Buffer.from(update),
      snapshotText: snapshotText || "",
      updatedAt: new Date()
    }
  );

  emitRoomEvent(documentId, "sync:update", {
    documentId,
    update: Buffer.from(update).toString("base64")
  });

  schedulePersist(documentId);
}

/**
 * Flush all active rooms to storage.
 * @returns {Promise<void>} Resolves when all rooms persisted.
 */
async function flushAllRooms() {
  const promises = Array.from(rooms.keys()).map((roomId) => persistRoom(roomId));
  await Promise.all(promises);
}

/**
 * Shutdown room tracking and clear timers.
 * @returns {Promise<void>} Resolves when shutdown completes.
 */
async function shutdownRooms() {
  rooms.forEach((room) => {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
    }
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
    }
  });
  rooms.clear();
}

module.exports = {
  getOrCreateRoom,
  applyUpdate,
  applyAwareness,
  encodeStateAsUpdate,
  encodeAwareness,
  encodeFullAwareness,
  trackSocketJoin,
  trackSocketLeave,
  replaceRoomContent,
  flushAllRooms,
  shutdownRooms
};
