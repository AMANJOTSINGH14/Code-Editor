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

/**
 * Fetch active sockets in a room.
 * @param {string} roomId - Room identifier.
 * @returns {Promise<Array<import("socket.io").Socket>>} Room sockets.
 */
async function getRoomSockets(roomId) {
  if (!ioInstance) {
    return [];
  }
  try {
    return await ioInstance.in(roomId).fetchSockets();
  } catch {
    return [];
  }
}

/**
 * Get the real local Socket instances in a room. Unlike getRoomSockets
 * (fetchSockets returns RemoteSockets without custom props), these carry
 * `socket.user`, so callers can authorize/kick specific users.
 * @param {string} roomId - Room identifier.
 * @returns {Array<import("socket.io").Socket>} Local room sockets.
 */
function getLocalRoomSockets(roomId) {
  if (!ioInstance) {
    return [];
  }
  const ids = ioInstance.sockets.adapter.rooms.get(roomId) || new Set();
  const sockets = [];
  ids.forEach((id) => {
    const socket = ioInstance.sockets.sockets.get(id);
    if (socket) {
      sockets.push(socket);
    }
  });
  return sockets;
}

module.exports = {
  setSocketServer,
  emitRoomEvent,
  getRoomSockets,
  getLocalRoomSockets
};
