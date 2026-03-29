require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });
require("dotenv").config();

const { embedRagDocuments } = require("../services/rag.service");
const logger = require("../utils/logger");

/**
 * Run the RAG embedding pipeline.
 * @returns {Promise<void>} Resolves when complete.
 */
async function run() {
  logger.info({ message: "Starting RAG embedding pipeline..." });
  const count = await embedRagDocuments();
  logger.info({ message: "RAG documents embedded", chunks: count });
  process.exit(0);
}

run().catch((error) => {
  logger.error({ message: "Embedding failed", error });
  process.exit(1);
});
