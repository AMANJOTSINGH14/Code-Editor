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

// If the live model produces no token within this budget (slow or rate-limited),
// the streaming review falls back to the cached/mock review so the UI never hangs.
const FIRST_TOKEN_TIMEOUT_MS = 6000;

// Total budget for the non-streaming review. A full gemini-2.5-flash response
// regularly takes 10-15s, so this must sit well above that or real reviews get
// silently replaced by the cached fallback.
const REVIEW_TIMEOUT_MS = 30000;

// Shown to the user whenever the cached review is served instead of a live
// one, so a fallback is never mistaken for a real review of their code.
const FALLBACK_NOTICE =
  "AI service was slow or unavailable — showing a generic review checklist instead of a live review of your code.";

// Gemini REST API base (v1). We call the REST API directly instead of going
// through @langchain/google-genai: the pinned wrapper is old and silently 404s
// on newer model names, and the REST path is the one already proven to work for
// embeddings (see rag.service.js).
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1";

// Ordered list of models the review tries, best/most-available first. The
// configured model (GEMINI_MODEL) is tried first so it can be overridden via
// env; then verified-good fallbacks. The review recursively advances to the
// next model ONLY when a model is unavailable (404 not found / 429 quota /
// 5xx), so a single bad GEMINI_MODEL or one rate-limited model can never break
// the review. In the happy path this is a single call; the first two models are
// both reliably available on the current key, so the rare fallback resolves on
// the 2nd call. gemini-2.0-flash is a last resort (its free-tier quota is
// frequently exhausted).
const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];

// Prepended to the user prompt: the /v1 generateContent endpoint does not accept
// a separate systemInstruction field, so the reviewer persona is folded in here.
const SYSTEM_PREAMBLE =
  "You are a senior software engineer performing a code review. Be specific and actionable.\n\n";

/**
 * Build the ordered, de-duplicated list of model names to try.
 * @returns {string[]} Model candidates, configured model first.
 */
function getModelCandidates() {
  const configured = (config.gemini.model || "").trim();
  return [...new Set([configured, ...FALLBACK_MODELS].filter(Boolean))];
}

/**
 * Whether an HTTP status means "this model is unavailable, try the next one"
 * (rather than a hard error we should surface): 404 not found, 429 quota,
 * or any 5xx transient/overloaded response.
 * @param {number} status - HTTP status code.
 * @returns {boolean} True if we should fall back to the next model.
 */
function isFallbackStatus(status) {
  return status === 404 || status === 429 || status >= 500;
}

/**
 * Ensure a usable Gemini API key is configured.
 * @returns {void}
 * @throws {AppError} When the key is missing or still the placeholder.
 */
function ensureApiKey() {
  if (!config.gemini.apiKey || config.gemini.apiKey === "your-gemini-api-key") {
    throw new AppError(
      "Gemini API key not configured. Set GEMINI_API_KEY in your .env file.",
      503,
      "CONFIG_ERROR"
    );
  }
}

/**
 * Build the generateContent request body for a prompt.
 * @param {string} prompt - Review prompt.
 * @returns {Object} Request body.
 */
function buildRequestBody(prompt) {
  return {
    contents: [{ role: "user", parts: [{ text: SYSTEM_PREAMBLE + prompt }] }],
    generationConfig: { temperature: 0.2 }
  };
}

/**
 * Extract the text from a Gemini generateContent / stream chunk JSON.
 * @param {Object} json - Parsed Gemini response or stream chunk.
 * @returns {string} Concatenated text from the first candidate.
 */
function extractText(json) {
  const parts = (json && json.candidates && json.candidates[0] &&
    json.candidates[0].content && json.candidates[0].content.parts) || [];
  return parts.map((part) => part.text || "").join("");
}

/**
 * Non-streaming review with recursive model fallback.
 * Tries `models[0]`; on a fallback-worthy HTTP status or network error it
 * recurses into the remaining models. Throws only when every model is exhausted.
 * @param {string[]} models - Ordered candidate model names.
 * @param {string} prompt - Review prompt.
 * @param {AbortSignal} [signal] - Optional abort signal.
 * @returns {Promise<string>} Review text.
 */
async function generateRecursive(models, prompt, signal) {
  const [model, ...rest] = models;
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${config.gemini.apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(prompt)),
      signal
    });
  } catch (networkError) {
    if (signal && signal.aborted) throw networkError;
    if (rest.length) {
      logger.warn({ message: "Review model network error, falling back", model, error: networkError.message });
      return generateRecursive(rest, prompt, signal);
    }
    throw networkError;
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (rest.length && isFallbackStatus(res.status)) {
      logger.warn({ message: "Review model unavailable, falling back", model, status: res.status, detail });
      return generateRecursive(rest, prompt, signal);
    }
    throw new AppError(`Gemini review failed [${res.status}]: ${detail}`, 502, "LLM_ERROR");
  }

  return extractText(await res.json());
}

/**
 * Streaming review with recursive model fallback. Yields text fragments as the
 * model produces them. Fallback to the next model happens before any token is
 * emitted (on a non-OK HTTP status / pre-stream network error), so a partially
 * streamed response is never restarted.
 * @param {string[]} models - Ordered candidate model names.
 * @param {string} prompt - Review prompt.
 * @param {AbortSignal} [signal] - Optional abort signal.
 * @returns {AsyncGenerator<string>} Text fragments.
 */
async function* streamRecursive(models, prompt, signal) {
  const [model, ...rest] = models;
  const url = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${config.gemini.apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(prompt)),
      signal
    });
  } catch (networkError) {
    if (signal && signal.aborted) throw networkError;
    if (rest.length) {
      logger.warn({ message: "Review model network error, falling back", model, error: networkError.message });
      yield* streamRecursive(rest, prompt, signal);
      return;
    }
    throw networkError;
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (rest.length && isFallbackStatus(res.status)) {
      logger.warn({ message: "Review model unavailable, falling back", model, status: res.status, detail });
      yield* streamRecursive(rest, prompt, signal);
      return;
    }
    throw new AppError(`Gemini review failed [${res.status}]: ${detail}`, 502, "LLM_ERROR");
  }

  // Parse the SSE body: events are separated by a blank line and Gemini uses
  // CRLF line endings, so split on \r\n\r\n OR \n\n (and split lines on \r?\n).
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || "";
    for (const event of events) {
      const dataLine = event.split(/\r?\n/).find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const text = extractText(JSON.parse(data));
        if (text) yield text;
      } catch {
        // Ignore a partial/un-parseable SSE frame; the next read completes it.
      }
    }
  }
}

/**
 * Generate a full review (non-streaming), honoring GEMINI_MOCK and the recursive
 * model fallback.
 * @param {string} prompt - Review prompt.
 * @param {AbortSignal} [signal] - Optional abort signal.
 * @returns {Promise<string>} Review text.
 */
async function generateReview(prompt, signal) {
  if (process.env.GEMINI_MOCK === "true") return MOCK_REVIEW_TEXT;
  ensureApiKey();
  return generateRecursive(getModelCandidates(), prompt, signal);
}

/**
 * Stream review text fragments, honoring GEMINI_MOCK and the recursive model
 * fallback.
 * @param {string} prompt - Review prompt.
 * @param {AbortSignal} [signal] - Optional abort signal.
 * @returns {AsyncGenerator<string>} Text fragments.
 */
async function* streamReviewTokens(prompt, signal) {
  if (process.env.GEMINI_MOCK === "true") {
    for (const word of MOCK_REVIEW_TEXT.split(" ")) {
      yield word + " ";
      await new Promise((r) => setTimeout(r, 15));
    }
    return;
  }
  ensureApiKey();
  yield* streamRecursive(getModelCandidates(), prompt, signal);
}

// Canned review used for explicit GEMINI_MOCK mode AND as the automatic
// fallback when the live model is too slow / rate-limited.
const MOCK_REVIEW_TEXT =
  "## AI Review\n\n" +
  "### 🟢 Strengths\n- Code is readable and the intent is clear.\n\n" +
  "### 🔴 Issues Found\n" +
  "- Avoid `var` — use `const`/`let` for block scoping.\n" +
  "- Use `===`/`!==` instead of `==`/`!=` to avoid coercion bugs.\n" +
  "- Don't swallow errors in empty `catch` blocks — log or re-throw.\n" +
  "- Never build queries by string concatenation — use parameterized queries.\n\n" +
  "### ⚡ Performance\n- Avoid `await` inside loops; run independent calls with `Promise.all`.\n\n" +
  "### 🔒 Security\n- Avoid `eval`; validate and sanitize all external input.\n";

/**
 * Reject if a promise does not settle within `ms`.
 * @param {Promise<any>} promise - Promise to guard.
 * @param {number} ms - Timeout in milliseconds.
 * @returns {Promise<any>} Settles with the promise or rejects on timeout.
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Stream the cached review over SSE (the live-model fallback).
 * @param {Function} writeSse - SSE writer.
 * @param {() => boolean} isClosed - Returns true once the connection closed.
 * @returns {Promise<string>} The full streamed text.
 */
async function streamMockReview(writeSse, isClosed) {
  for (const word of MOCK_REVIEW_TEXT.split(" ")) {
    if (isClosed()) return MOCK_REVIEW_TEXT;
    writeSse(null, { text: word + " " });
    await new Promise((r) => setTimeout(r, 15));
  }
  return MOCK_REVIEW_TEXT;
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

  try {
    const text = await withTimeout(generateReview(prompt), REVIEW_TIMEOUT_MS);
    await saveReviewHistory({ documentId, userId, reviewText: text, model: config.gemini.model, notice, contextChunks });
    return { text, notice };
  } catch (timeoutOrError) {
    logger.warn({ message: "Live review slow/unavailable, using fallback", error: timeoutOrError.message });
    notice = notice ? `${notice} ${FALLBACK_NOTICE}` : FALLBACK_NOTICE;
    return { text: MOCK_REVIEW_TEXT, notice };
  }
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

    // Stream the live model. An abort-timer caps how long we wait for the FIRST
    // token: if none arrives within the budget (slow / rate-limited), the stream
    // is aborted and we fall back to the cached review so the panel never hangs.
    // Once real tokens start, we commit to the live response. Model unavailability
    // (404/429/5xx) is handled earlier by the recursive model fallback.
    const controller = new AbortController();
    let firstTokenSeen = false;
    let fullText = "";
    const firstTokenTimer = setTimeout(() => {
      if (!firstTokenSeen) controller.abort();
    }, FIRST_TOKEN_TIMEOUT_MS);

    try {
      for await (const text of streamReviewTokens(prompt, controller.signal)) {
        if (closed) {
          clearTimeout(firstTokenTimer);
          return;
        }
        if (!text) continue;
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          clearTimeout(firstTokenTimer);
        }
        fullText += text;
        writeSse(null, { text });
      }
      clearTimeout(firstTokenTimer);
    } catch (streamError) {
      clearTimeout(firstTokenTimer);
      if (firstTokenSeen) {
        // Errored after partial output — keep what we streamed and stop.
        logger.warn({ message: "Live review interrupted mid-stream", error: streamError.message });
      } else {
        // No token before the deadline / error — stream the cached review, and
        // tell the client it is NOT a live review of their code.
        logger.warn({ message: "Live review unavailable, using fallback", error: streamError.message });
        notice = notice ? `${notice} ${FALLBACK_NOTICE}` : FALLBACK_NOTICE;
        writeSse("notice", { notice });
        fullText = await streamMockReview(writeSse, () => closed);
      }
    }

    if (closed) return;

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
