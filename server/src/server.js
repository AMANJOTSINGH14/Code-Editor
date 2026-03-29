const http = require("http");
const app = require("./app");
const config = require("./config");
const { connectWithRetry, disconnect } = require("./config/db");
const { initRedis, closeRedis } = require("./config/redis");
const { initSocketServer } = require("./config/socket");
const { registerSocketHandlers } = require("./socket");
const { flushAllRooms, shutdownRooms } = require("./services/crdt.service");
const logger = require("./utils/logger");

/**
 * Start the HTTP and Socket.io servers.
 * @returns {Promise<void>} Resolves when server is listening.
 */
async function startServer() {
  initRedis();
  await connectWithRetry();

  const server = http.createServer(app);
  const io = initSocketServer(server);
  registerSocketHandlers(io);

  server.listen(config.port, () => {
    logger.info({ message: "Server listening", port: config.port });
  });

  const shutdown = async () => {
    logger.info({ message: "Graceful shutdown started" });
    await flushAllRooms();
    await shutdownRooms();
    io.close();
    server.close();
    await disconnect();
    await closeRedis();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  logger.error({ message: "Server failed to start", error });
  process.exit(1);
});
