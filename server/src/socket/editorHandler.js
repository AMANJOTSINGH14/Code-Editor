const { applyUpdate, applyAwareness, encodeStateAsUpdate } = require("../services/crdt.service");

/**
 * Decode a base64 string to Uint8Array.
 * @param {string} data - Base64 data.
 * @returns {Uint8Array} Binary data.
 */
function decodeUpdate(data) {
  return new Uint8Array(Buffer.from(data, "base64"));
}

/**
 * Register editor-related socket handlers.
 * @param {import("socket.io").Server} io - Socket.io server.
 * @param {import("socket.io").Socket} socket - Socket instance.
 * @param {Function} wrap - Error wrapper.
 * @returns {void}
 */
function registerEditorHandlers(io, socket, wrap) {
  socket.on(
    "sync:update",
    wrap(async ({ documentId, update }) => {
      const updateBinary = decodeUpdate(update);
      await applyUpdate({ documentId, update: updateBinary, actorId: socket.user.id });
      socket.to(documentId).emit("sync:update", { documentId, update });
    })
  );

  socket.on(
    "sync:state-vector",
    wrap(async ({ documentId, stateVector }) => {
      const vectorBinary = decodeUpdate(stateVector);
      const update = await encodeStateAsUpdate(documentId, vectorBinary);
      socket.emit("sync:update", {
        documentId,
        update: Buffer.from(update).toString("base64")
      });
    })
  );

  socket.on(
    "awareness:update",
    wrap(async ({ documentId, update }) => {
      const awarenessBinary = decodeUpdate(update);
      await applyAwareness({ documentId, update: awarenessBinary, origin: socket.id });
      socket.to(documentId).emit("awareness:update", { documentId, update });
    })
  );
}

module.exports = {
  registerEditorHandlers
};
