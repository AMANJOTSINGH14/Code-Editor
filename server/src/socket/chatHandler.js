const crypto = require("crypto");

/**
 * Register chat-related socket handlers.
 * @param {import("socket.io").Server} io - Socket.io server.
 * @param {import("socket.io").Socket} socket - Socket instance.
 * @param {Function} wrap - Error wrapper.
 * @returns {void}
 */
function registerChatHandlers(io, socket, wrap) {
  socket.on(
    "chat:message",
    wrap(async ({ documentId, message }) => {
      const payload = {
        id: crypto.randomUUID(),
        documentId,
        message,
        user: socket.user,
        createdAt: new Date().toISOString()
      };

      io.to(documentId).emit("chat:message", payload);
    })
  );
}

module.exports = {
  registerChatHandlers
};
