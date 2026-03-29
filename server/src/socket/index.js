const logger = require("../utils/logger");
const { setSocketServer } = require("./emitter");
const { registerRoomHandlers } = require("./roomHandler");
const { registerEditorHandlers } = require("./editorHandler");
const { registerChatHandlers } = require("./chatHandler");

/**
 * Wrap a socket event handler with error handling.
 * @param {import("socket.io").Socket} socket - Socket instance.
 * @param {Function} handler - Async handler.
 * @returns {Function} Wrapped handler.
 */
function wrapSocketHandler(socket, handler) {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      logger.error({ message: "Socket handler error", error: error.message || error, stack: error.stack });
      if (socket.connected) {
        socket.emit("error", {
          message: "Socket error",
          code: "SOCKET_ERROR"
        });
      }
    }
  };
}

/**
 * Register Socket.io handlers.
 * @param {import("socket.io").Server} io - Socket.io server.
 * @returns {void}
 */
function registerSocketHandlers(io) {
  setSocketServer(io);

  io.on("connection", (socket) => {
    const wrap = (handler) => wrapSocketHandler(socket, handler);
    registerRoomHandlers(io, socket, wrap);
    registerEditorHandlers(io, socket, wrap);
    registerChatHandlers(io, socket, wrap);
  });
}

module.exports = {
  registerSocketHandlers
};
