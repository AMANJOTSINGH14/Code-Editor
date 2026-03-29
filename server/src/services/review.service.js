const ReviewHistory = require("../models/ReviewHistory");
const AppError = require("../utils/AppError");
const config = require("../config");
const logger = require("../utils/logger");
const { getDocumentById } = require("./document.service");
const { getOrCreateRoom } = require("./crdt.service");
const {
  retrieveContext,
  estimateTokens,
  splitCodeByBoundary,
  selectRelevantChunk,
  buildReviewPrompt
} = require("./rag.service");

/**
 * Build a Gemini chat model instance.
 * @returns {Promise<Object>} Gemini chat model.
 */
async function getChatModel() {
  if (!config.gemini.apiKey || config.gemini.apiKey === "your-gemini-api-key") {
    throw new AppError(
      "Gemini API key not configured. Set GEMINI_API_KEY in your .env file.",
      503,
      "CONFIG_ERROR"
    );
  }

  const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
  return new ChatGoogleGenerativeAI({
    apiKey: config.gemini.apiKey,
    model: config.gemini.model,
    temperature: 0.2
  });
}

/**
 * Normalize chunk content from LangChain stream.
 * @param {Object} chunk - Stream chunk.
 * @returns {string} Text content.
 */
function normalizeChunk(chunk) {
  if (!chunk) return "";
  if (typeof chunk.content === "string") return chunk.content;
  if (Array.isArray(chunk.content)) {
    return chunk.content.map((part) => part.text || "").join("");
  }
  return String(chunk.content || "");
}

/**
 * Load the latest code snapshot for review.
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @returns {Promise<string>} Code snapshot.
 */
async function loadCodeSnapshot(documentId, userId) {
  await getDocumentById(documentId, userId);
  const room = await getOrCreateRoom(documentId);
  return room.doc.getText("content").toString() || "";
}

/**
 * Save review history to database.
 * @param {Object} payload - Review data.
 * @returns {Promise<void>} Resolves when saved.
 */
async function saveReviewHistory(payload) {
  try {
    await ReviewHistory.create(payload);
  } catch (error) {
    logger.error({ message: "Failed to save review history", error });
  }
}

/**
 * Run a non-streaming review.
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @returns {Promise<Object>} Review response.
 */
async function runReview(documentId, userId) {
  const code = await loadCodeSnapshot(documentId, userId);
  if (!code.trim()) {
    return { text: "Nothing to review yet. Add some code and try again.", notice: "" };
  }

  const contextChunks = await retrieveContext(code, 3);
  const contextText = contextChunks.map((chunk) => chunk.content).join("\n\n");
  let notice = "";
  let codeForReview = code;

  if (estimateTokens(code) > 3000) {
    const chunks = splitCodeByBoundary(code);
    codeForReview = selectRelevantChunk(chunks, contextText);
    notice = "Large file — reviewing the most relevant section.";
  }

  const prompt = buildReviewPrompt(contextText, codeForReview);
  const model = await getChatModel();
  const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");
  const response = await model.invoke([
    new SystemMessage("You are a senior software engineer performing a code review. Be specific and actionable."),
    new HumanMessage(prompt)
  ]);

  const text = normalizeChunk(response);

  await saveReviewHistory({
    documentId,
    userId,
    reviewText: text,
    model: config.gemini.model,
    notice,
    contextChunks
  });

  return { text, notice };
}

/**
 * Stream a review response over SSE.
 * @param {string} documentId - Document id.
 * @param {string} userId - User id.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>} Resolves when streaming ends.
 */
async function streamReview(documentId, userId, res) {
  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  const writeSse = (event, data) => {
    if (closed) return;
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const code = await loadCodeSnapshot(documentId, userId);
    if (!code.trim()) {
      writeSse(null, { text: "Nothing to review yet. Add some code and try again." });
      writeSse("done", {});
      res.end();
      return;
    }

    const contextChunks = await retrieveContext(code, 3);
    const contextText = contextChunks.map((chunk) => chunk.content).join("\n\n");
    let notice = "";
    let codeForReview = code;

    if (estimateTokens(code) > 3000) {
      const chunks = splitCodeByBoundary(code);
      codeForReview = selectRelevantChunk(chunks, contextText);
      notice = "Large file — reviewing the most relevant section.";
      writeSse("notice", { notice });
    }

    const prompt = buildReviewPrompt(contextText, codeForReview);
    const model = await getChatModel();
    const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");
    const stream = await model.stream([
      new SystemMessage("You are a senior software engineer performing a code review. Be specific and actionable."),
      new HumanMessage(prompt)
    ]);

    let fullText = "";

    for await (const chunk of stream) {
      if (closed) return;
      const text = normalizeChunk(chunk);
      if (!text) continue;
      fullText += text;
      writeSse(null, { text });
    }

    await saveReviewHistory({
      documentId,
      userId,
      reviewText: fullText,
      model: config.gemini.model,
      notice,
      contextChunks
    });

    writeSse("done", {});
    res.end();
  } catch (error) {
    logger.error({ message: "Stream review failed", error });
    if (!closed) {
      writeSse("error", { message: error.message || "Review failed" });
      res.end();
    }
  }
}

module.exports = {
  runReview,
  streamReview
};
