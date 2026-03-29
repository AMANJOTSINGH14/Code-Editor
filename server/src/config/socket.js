const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const config = require("./index");
const redis = require("./redis");
const { verifyAccessToken } = require("../services/auth.service");
const logger = require("../utils/logger");

/**
 * Initialize Socket.io server with optional Redis adapter.
 * @param {import("http").Server} httpServer - HTTP server instance.
 * @returns {import("socket.io").Server} Socket.io server.
 */
function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.clientUrl,
      credentials: true
    },
    pingInterval: 10000,
    pingTimeout: 5000
  });

  if (redis.isRedisReady() && redis.redisPub && redis.redisSub) {
    io.adapter(createAdapter(redis.redisPub, redis.redisSub));
    logger.info({ message: "Socket.io Redis adapter enabled" });
  } else {
    logger.warn({ message: "Redis unavailable, Socket.io running in single-instance mode" });
  }

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Missing auth token"));
    }
    try {
      const user = verifyAccessToken(token);
      socket.user = user;
      return next();
    } catch (error) {
      return next(new Error("Invalid auth token"));
    }
  });

  return io;
}

module.exports = {
  initSocketServer
};
