const fs = require("fs");
const path = require("path");
const config = require("../config");
const logger = require("../utils/logger");

let embeddingsClient = null;
let vectorStore = null;
let ragAvailable = false;

/**
 * Get a Gemini embeddings client.
 * @returns {Promise<Object>} Embeddings client.
 */
async function getEmbeddingsClient() {
  if (embeddingsClient) {
    return embeddingsClient;
  }

  if (!config.gemini.apiKey) {
    return null;
  }

  const { GoogleGenerativeAIEmbeddings } = await import("@langchain/google-genai");
  embeddingsClient = new GoogleGenerativeAIEmbeddings({
    apiKey: config.gemini.apiKey,
    model: config.gemini.embeddingModel
  });

  return embeddingsClient;
}

/**
 * Get a Chroma vector store instance.
 * @returns {Promise<Object|null>} Vector store or null if unavailable.
 */
async function getVectorStore() {
  if (vectorStore) {
    return vectorStore;
  }

  try {
    const { Chroma } = await import("@langchain/community/vectorstores/chroma");
    const embeddings = await getEmbeddingsClient();
    if (!embeddings) {
      return null;
    }

    vectorStore = await Chroma.fromExistingCollection(embeddings, {
      collectionName: "collab-code-editor",
      url: config.chromaUrl
    });
    ragAvailable = true;
    return vectorStore;
  } catch (error) {
    logger.warn({ message: "ChromaDB unavailable, RAG disabled", error: error.message });
    ragAvailable = false;
    return null;
  }
}

/**
 * Read RAG documents from disk.
 * @returns {Array<{content: string, source: string}>} Documents.
 */
function readRagDocs() {
  const docsPath = path.resolve(config.ragDocsPath);
  if (!fs.existsSync(docsPath)) {
    logger.warn({ message: "RAG docs path not found", path: docsPath });
    return [];
  }
  const entries = fs.readdirSync(docsPath);
  return entries
    .filter((file) => file.endsWith(".md"))
    .map((file) => ({
      source: file,
      content: fs.readFileSync(path.join(docsPath, file), "utf8")
    }));
}

/**
 * Embed and store RAG documents in Chroma.
 * @returns {Promise<number>} Number of embedded chunks.
 */
async function embedRagDocuments() {
  const { RecursiveCharacterTextSplitter } = await import("langchain/text_splitter");
  const { Document } = await import("@langchain/core/documents");
  const { Chroma } = await import("@langchain/community/vectorstores/chroma");

  const embeddings = await getEmbeddingsClient();
  if (!embeddings) {
    logger.warn({ message: "Cannot embed RAG docs - no Gemini API key" });
    return 0;
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50
  });

  const rawDocs = readRagDocs();
  if (rawDocs.length === 0) {
    logger.warn({ message: "No RAG documents found to embed" });
    return 0;
  }

  const documents = rawDocs.map((doc, index) =>
    new Document({
      pageContent: doc.content,
      metadata: {
        source: doc.source,
        chunkId: `${doc.source}-${index}`
      }
    })
  );

  const chunks = await splitter.splitDocuments(documents);

  vectorStore = await Chroma.fromDocuments(chunks, embeddings, {
    collectionName: "collab-code-editor",
    url: config.chromaUrl
  });
  ragAvailable = true;

  return chunks.length;
}

/**
 * Retrieve top-k relevant context chunks.
 * Returns empty array if RAG is unavailable.
 * @param {string} query - Query text.
 * @param {number} [topK=3] - Number of chunks.
 * @returns {Promise<Array<Object>>} Context chunks.
 */
async function retrieveContext(query, topK = 3) {
  try {
    const store = await getVectorStore();
    if (!store) {
      return [];
    }
    const results = await store.similaritySearchWithScore(query, topK);
    return results.map(([doc, score], index) => ({
      chunkId: doc.metadata.chunkId || `chunk-${index}`,
      content: doc.pageContent,
      score
    }));
  } catch (error) {
    logger.warn({ message: "RAG retrieval failed, continuing without context", error: error.message });
    return [];
  }
}

/**
 * Estimate token count for a text.
 * @param {string} text - Input text.
 * @returns {number} Estimated token count.
 */
function estimateTokens(text) {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/**
 * Split code into logical chunks.
 * @param {string} code - Code content.
 * @returns {Array<string>} Code chunks.
 */
function splitCodeByBoundary(code) {
  const lines = code.split("\n");
  const chunks = [];
  let current = [];

  const boundaryRegex = /^(export\s+)?(class|function|const|let|var)\b/;

  lines.forEach((line) => {
    if (boundaryRegex.test(line) && current.length) {
      chunks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  });

  if (current.length) {
    chunks.push(current.join("\n"));
  }

  return chunks.filter((chunk) => chunk.trim().length > 0);
}

/**
 * Select the most relevant chunk using context keywords.
 * @param {Array<string>} chunks - Candidate chunks.
 * @param {string} contextText - Combined context.
 * @returns {string} Selected chunk.
 */
function selectRelevantChunk(chunks, contextText) {
  if (chunks.length === 0) {
    return "";
  }

  const keywords = contextText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);

  const frequency = keywords.reduce((acc, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {});

  const scored = chunks.map((chunk) => {
    const words = chunk.toLowerCase().split(/\W+/);
    const score = words.reduce((sum, word) => sum + (frequency[word] || 0), 0);
    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].chunk || chunks[0];
}

/**
 * Build review prompt from context and code.
 * @param {string} context - Retrieved context.
 * @param {string} code - Code to review.
 * @returns {string} Review prompt.
 */
function buildReviewPrompt(context, code) {
  let prompt = "";
  if (context && context.trim()) {
    prompt += `Use the following best-practices context when helpful:\n\n${context}\n\n`;
  }
  prompt += `Review the following code. Provide specific, actionable feedback on bugs, performance, security, and code quality. Format your response with clear headings and bullet points:\n\n\`\`\`\n${code}\n\`\`\``;
  return prompt;
}

/**
 * Override the vector store (tests only).
 * @param {Object|null} store - Vector store instance.
 * @returns {void}
 */
function setVectorStoreForTest(store) {
  vectorStore = store;
  ragAvailable = Boolean(store);
}

module.exports = {
  embedRagDocuments,
  retrieveContext,
  estimateTokens,
  splitCodeByBoundary,
  selectRelevantChunk,
  buildReviewPrompt,
  setVectorStoreForTest
};
