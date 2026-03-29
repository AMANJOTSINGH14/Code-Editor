let ioInstance = null;

/**
 * Set the Socket.io server instance for cross-module emission.
 * @param {import("socket.io").Server} io - Socket.io server.
 * @returns {void}
 */
function setSocketServer(io) {
  ioInstance = io;
}

/**
 * Emit an event to a room if Socket.io is initialized.
 * @param {string} roomId - Room identifier.
 * @param {string} event - Event name.
 * @param {Object} payload - Event payload.
 * @returns {void}
 */
function emitRoomEvent(roomId, event, payload) {
  if (!ioInstance) {
    return;
  }
  ioInstance.to(roomId).emit(event, payload);
}

module.exports = {
  setSocketServer,
  emitRoomEvent
};
