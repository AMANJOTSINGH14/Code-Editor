const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer = null;

/**
 * Set baseline environment variables for tests.
 * @returns {void}
 */
function setTestEnv() {
  process.env.NODE_ENV = "test";
  process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/test";
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-access";
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh";
  process.env.CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
  process.env.REDIS_URL = "";
  process.env.GEMINI_API_KEY = "test-key";
  process.env.CHROMA_URL = "http://localhost:8000";
  process.env.COOKIE_SECURE = "false";
  process.env.COOKIE_DOMAIN = "";
  process.env.COOKIE_SAMESITE = "lax";
}

/**
 * Connect to in-memory MongoDB.
 * @returns {Promise<void>} Resolves when connected.
 */
async function connectTestDb() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
}

/**
 * Clear all test collections.
 * @returns {Promise<void>} Resolves when cleared.
 */
async function clearTestDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

/**
 * Disconnect and stop in-memory MongoDB.
 * @returns {Promise<void>} Resolves when stopped.
 */
async function disconnectTestDb() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

module.exports = {
  setTestEnv,
  connectTestDb,
  clearTestDb,
  disconnectTestDb
};
