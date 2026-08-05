const fs = require("fs");
const path = require("path");
const config = require("../config");
const logger = require("../utils/logger");

/**
 * @typedef {Object} EmbeddingsClient
 * @property {(texts: string[]) => Promise<number[][]>} embedDocuments
 * @property {(text: string) => Promise<number[]>} embedQuery
 */

/** @type {EmbeddingsClient|null} */
let embeddingsClient = null;
let vectorStore = null;
let ragAvailable = false;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1";
// Pace single embedContent calls to stay under free-tier limits for
// gemini-embedding-001 (100 req/min, 30K tokens/min).
const EMBED_PACE_MS = 1200;

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hard cap on how long the RAG lookup may take before the review proceeds
// without context. A normal Gemini embedQuery round-trip takes ~1.2s, so this
// must sit comfortably above that or context gets silently dropped; it still
// bounds the wait so a rate-limited embedding call can't hang the review.
const RAG_TIMEOUT_MS = 4000;

/**
 * Reject if a promise does not settle in time, so a slow/rate-limited
 * dependency can never block the review pipeline.
 * @param {Promise<any>} promise - Promise to guard.
 * @param {number} ms - Timeout in milliseconds.
 * @param {string} label - Label for the timeout error.
 * @returns {Promise<any>} Settles with the promise or rejects on timeout.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Build a minimal Gemini embeddings client over the v1 REST API.
 *
 * This key's embedding models only support the synchronous single-item
 * `embedContent` method (no sync `batchEmbedContents`, and async batch jobs
 * require a billing-enabled project -> FAILED_PRECONDITION). So embedDocuments
 * loops one paced call per text with retry/backoff on rate limits.
 * @param {string} apiKey - Gemini API key.
 * @param {string} model - Embedding model name.
 * @returns {EmbeddingsClient} Embeddings client.
 */
function createGeminiEmbeddings(apiKey, model) {
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;

  /**
   * POST with retry/backoff on rate-limit (429) and transient (5xx) errors.
   * @param {string} method - REST method (embedContent).
   * @param {object} body - JSON request body.
   * @returns {Promise<any>} Parsed JSON response.
   */
  async function post(method, body) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetch(`${GEMINI_API_BASE}/${modelPath}:${method}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        return res.json();
      }
      const detail = await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Gemini ${method} [${res.status}]: ${detail.slice(0, 200)}`);
        await sleep(2000 * (attempt + 1)); // backoff, then retry
        continue;
      }
      throw new Error(`Gemini ${method} failed [${res.status}]: ${detail.slice(0, 300)}`);
    }
    throw lastError;
  }

  /**
   * @param {string} text - Query text.
   * @returns {Promise<number[]>} Query vector.
   */
  async function embedQuery(text) {
    const json = await post("embedContent", {
      model: modelPath,
      content: { parts: [{ text }] }
    });
    return (json.embedding && json.embedding.values) || [];
  }

  /**
   * Embed many texts with one paced single call each (no batch endpoint here).
   * @param {string[]} texts - Texts to embed.
   * @returns {Promise<number[][]>} One vector per text.
   */
  async function embedDocuments(texts) {
    /** @type {number[][]} */
    const vectors = [];
    for (let i = 0; i < texts.length; i += 1) {
      vectors.push(await embedQuery(texts[i]));
      if (i < texts.length - 1) {
        await sleep(EMBED_PACE_MS);
      }
    }
    return vectors;
  }

  return { embedDocuments, embedQuery };
}

/**
 * Get a Gemini embeddings client.
 * @returns {Promise<Object|null>} Embeddings client or null if no API key.
 */
async function getEmbeddingsClient() {
  // In mock/demo mode, skip embeddings entirely so the review makes zero Gemini
  // calls (no rate-limit risk during a demo).
  if (process.env.GEMINI_MOCK === "true") {
    return null;
  }

  if (embeddingsClient) {
    return embeddingsClient;
  }

  if (!config.gemini.apiKey) {
    return null;
  }

  embeddingsClient = createGeminiEmbeddings(config.gemini.apiKey, config.gemini.embeddingModel);
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
      collectionName: "collab_rag_v2",
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
  // Resolve relative to the project root (not process.cwd) so the docs are found
  // whether the script is run from server/ via npm or from the repo root.
  const projectRoot = path.resolve(__dirname, "../../..");
  const docsPath = path.resolve(projectRoot, config.ragDocsPath);
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

  const rawDocs = readRagDocs();
  if (rawDocs.length === 0) {
    logger.warn({ message: "No RAG documents found to embed" });
    return 0;
  }

  // Larger chunks => fewer chunks => fewer one-per-chunk embedContent calls.
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2000,
    chunkOverlap: 150
  });

  const documents = rawDocs.map((doc) =>
    new Document({
      pageContent: doc.content,
      metadata: { source: doc.source }
    })
  );

  const chunks = await splitter.splitDocuments(documents);
  chunks.forEach((chunk, index) => {
    chunk.metadata.chunkId = `${chunk.metadata.source || "doc"}-${index}`;
  });

  // Validate the Chroma backend (client installed + server reachable + collection
  // creatable) BEFORE spending any Gemini embedding calls. langchain's
  // Chroma.fromDocuments embeds first and connects second, so a missing client or
  // a down server silently wastes the whole embedding run. Fail fast here instead.
  const store = new Chroma(embeddings, {
    collectionName: "collab_rag_v2",
    url: config.chromaUrl
  });
  await store.ensureCollection();

  // Embed (one paced call per chunk), then verify every chunk produced a
  // non-empty vector before storing, so we never persist corrupt embeddings.
  const texts = chunks.map((chunk) => chunk.pageContent);
  const vectors = await embeddings.embedDocuments(texts);
  const badIndex = vectors.findIndex(
    (vector) => !Array.isArray(vector) || vector.length === 0
  );
  if (badIndex !== -1) {
    throw new Error(
      `Embedding failed for chunk ${badIndex}: received an empty vector`
    );
  }

  // Deterministic ids so re-running upserts in place instead of duplicating.
  const ids = chunks.map((chunk) => chunk.metadata.chunkId);
  await store.addVectors(vectors, chunks, { ids });

  vectorStore = store;
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

    const embeddings = await getEmbeddingsClient();
    if (!embeddings) {
      return [];
    }

    // Query the Chroma collection directly. langchain's similaritySearch always
    // sends `where: { ...filter }`, which collapses to an empty `{}` when no
    // filter is given - and Chroma >= 0.5 rejects an empty `where` with a 400.
    // So we embed the query ourselves and omit the filter entirely.
    const queryVector = await withTimeout(embeddings.embedQuery(query), RAG_TIMEOUT_MS, "RAG embedQuery");
    const collection = await store.ensureCollection();
    const result = await withTimeout(
      collection.query({ queryEmbeddings: [queryVector], nResults: topK }),
      RAG_TIMEOUT_MS,
      "RAG query"
    );

    const ids = (result.ids && result.ids[0]) || [];
    const documents = (result.documents && result.documents[0]) || [];
    const metadatas = (result.metadatas && result.metadatas[0]) || [];
    const distances = (result.distances && result.distances[0]) || [];

    return ids.map((id, index) => ({
      chunkId: (metadatas[index] && metadatas[index].chunkId) || id || `chunk-${index}`,
      content: documents[index] || "",
      score: distances[index]
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

/**
 * Override the embeddings client (tests only). Lets the storage path be
 * exercised end-to-end with deterministic vectors instead of real Gemini calls.
 * @param {EmbeddingsClient|null} client - Embeddings client with embedDocuments/embedQuery.
 * @returns {void}
 */
function setEmbeddingsClientForTest(client) {
  embeddingsClient = client;
}

module.exports = {
  embedRagDocuments,
  retrieveContext,
  estimateTokens,
  splitCodeByBoundary,
  selectRelevantChunk,
  buildReviewPrompt,
  setVectorStoreForTest,
  setEmbeddingsClientForTest
};
