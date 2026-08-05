const config = require("../config");
const logger = require("../../utils/logger");
const limiter = require("../quota/limiter");
const { DailyCapExceededError } = require("../quota/budget");

/**
 * Gemini client for the Agent Runner.
 *
 * ---------------------------------------------------------------------------
 * NO MODEL FALLBACK CHAIN — this is deliberate and load-bearing
 * ---------------------------------------------------------------------------
 * review.service.js recursively falls back across a list of models on 404/429/
 * 5xx. That is right for the reviewer (an unavailable model should not break a
 * user-facing review) and wrong here.
 *
 * In a retry loop, a 429 that silently escalates to a different model means the
 * run keeps succeeding while consuming quota from a tier nobody chose — and a
 * budget that counts CALLS cannot detect it, because the call count looks
 * identical. So this client pins exactly one model and never substitutes.
 *
 * ---------------------------------------------------------------------------
 * 429 is not one condition
 * ---------------------------------------------------------------------------
 * Verified against the live API: gemini-2.0-flash returns
 *
 *     429 ... "Quota exceeded ... limit: 0, model: gemini-2.0-flash"
 *
 * `limit: 0` means the free tier allocates NO quota for that model at all. It
 * is listed by ListModels and can never serve. Backing off and retrying can
 * never succeed — it just burns 15 seconds per call before failing anyway.
 *
 *   - 429 with limit > 0  → genuinely transient. Back off 1s/2s/4s/8s, SAME model.
 *   - 429 with limit == 0 → permanent. Fail loudly, like a 404.
 *   - 404                 → model unavailable. Fail loudly. Never substitute.
 *   - 5xx                 → transient. Back off, SAME model.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1";

// Exponential backoff for genuinely transient failures, as specified.
const BACKOFF_MS = [1000, 2000, 4000, 8000];

/**
 * Raised when the pinned model cannot serve and no retry can fix it.
 */
class ModelUnavailableError extends Error {
  /**
   * @param {string} model - The pinned model.
   * @param {number} status - HTTP status.
   * @param {string} detail - Response detail.
   */
  constructor(model, status, detail) {
    super(
      `Pinned Gemini model "${model}" is unavailable (HTTP ${status}). ` +
        "The agent runner does not substitute a different model — fix " +
        `AGENT_RUNNER_GEMINI_MODEL or the API key. Detail: ${detail}`
    );
    this.name = "ModelUnavailableError";
    this.code = "MODEL_UNAVAILABLE";
    this.status = status;
    this.model = model;
  }
}

/**
 * Raised when the model hit its output ceiling mid-response.
 */
class ResponseTruncatedError extends Error {
  /**
   * @param {string} model - The pinned model.
   * @param {number} limit - The configured maxOutputTokens.
   * @param {number} thoughtTokens - Tokens spent on internal reasoning.
   * @param {number} responseTokens - Tokens of visible output produced.
   */
  constructor(model, limit, thoughtTokens, responseTokens) {
    super(
      `Model "${model}" hit maxOutputTokens (${limit}) before finishing: ` +
        `${thoughtTokens} thinking tokens + ${responseTokens} visible tokens. ` +
        "Raise AGENT_RUNNER_GEMINI_MAX_OUTPUT_TOKENS — on a thinking model the " +
        "budget covers reasoning as well as the answer."
    );
    this.name = "ResponseTruncatedError";
    this.code = "RESPONSE_TRUNCATED";
    this.model = model;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extract the "limit: N" figure from a quota error body.
 *
 * This is what separates "you are going too fast" from "you have no allocation".
 * @param {string} body - Response body.
 * @returns {number|null} The limit, or null when absent.
 */
function parseQuotaLimit(body) {
  const match = /limit:\s*(\d+)/.exec(body || "");
  return match ? Number(match[1]) : null;
}

/**
 * Whether a 429 is permanent (no allocation) rather than transient.
 * @param {string} body - Response body.
 * @returns {boolean} True when retrying can never succeed.
 */
function isPermanentQuotaError(body) {
  return parseQuotaLimit(body) === 0;
}

/**
 * Ensure an API key is configured.
 * @returns {void}
 * @throws {Error} When missing or still the placeholder.
 */
function ensureApiKey() {
  if (!config.gemini.apiKey || config.gemini.apiKey === "your-gemini-api-key") {
    throw new Error("GEMINI_API_KEY is not configured — the agent runner cannot generate code.");
  }
}

/**
 * Pull the text out of a generateContent response.
 * @param {Object} json - Parsed response.
 * @returns {string} Concatenated text.
 */
function extractText(json) {
  const parts =
    (json && json.candidates && json.candidates[0] && json.candidates[0].content &&
      json.candidates[0].content.parts) || [];
  return parts.map((part) => part.text || "").join("");
}

/**
 * Call the pinned Gemini model once.
 *
 * Applies the two limits that are global to the process: the rate-limit slot
 * (which only delays) and the daily reservation (which can refuse). The PER-RUN
 * budget is deliberately NOT enforced here — it belongs to the orchestrator,
 * which owns the run. Enforcing it inside this client would make the
 * orchestrator's own budget checks work only as a side effect of this function
 * having been called, so swapping the client would silently disable the budget.
 *
 * @param {Object} options - Call options.
 * @param {string} options.prompt - Full prompt text.
 * @param {string} options.runId - Run id, for the audit log.
 * @param {number} [options.attemptIndex] - Attempt number, for the audit log.
 * @param {number} [options.temperature] - Sampling temperature.
 * @returns {Promise<{text: string, model: string, promptTokens: number, responseTokens: number, totalTokens: number, latencyMs: number, retries: number, queuedMs: number}>} Result plus audit metadata.
 */
async function generate({ prompt, runId, attemptIndex = null, temperature = 0.2 }) {
  ensureApiKey();

  const model = config.gemini.model;

  // 1. Pace. Queues rather than rejecting — never drops a call.
  const queuedMs = await limiter.acquireSlot();

  // 2. Global daily ceiling. Refuses rather than silently burning quota.
  const reservation = await limiter.reserveDailyCall();
  if (!reservation.allowed) {
    throw new DailyCapExceededError(reservation.used, reservation.cap);
  }

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${config.gemini.apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: config.gemini.maxOutputTokens }
  };

  const startedAt = Date.now();
  let retries = 0;
  let lastError = null;

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (networkError) {
      lastError = networkError;
      if (attempt < BACKOFF_MS.length) {
        retries += 1;
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      break;
    }

    if (res.ok) {
      const json = await res.json();
      const usage = json.usageMetadata || {};
      const candidate = (json.candidates || [])[0] || {};

      const result = {
        text: extractText(json),
        model,
        promptTokens: usage.promptTokenCount || 0,
        responseTokens: usage.candidatesTokenCount || 0,
        // Thinking models bill reasoning tokens that never appear in the
        // response. Recorded separately because they are the bulk of the spend
        // and are invisible in promptTokens + responseTokens.
        thoughtTokens: usage.thoughtsTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0,
        finishReason: candidate.finishReason || "",
        latencyMs: Date.now() - startedAt,
        retries,
        queuedMs
      };

      // A truncated response is NOT a successful call. gemini-2.5-flash is a
      // thinking model and maxOutputTokens covers thinking AND visible output,
      // so an under-sized budget is spent almost entirely on reasoning and the
      // response is cut off mid-answer — typically after "### PLAN" and before
      // the code fence. Left undetected this surfaces as the far more confusing
      // "could not extract code from the model response".
      if (candidate.finishReason === "MAX_TOKENS") {
        throw new ResponseTruncatedError(
          model,
          config.gemini.maxOutputTokens,
          result.thoughtTokens,
          result.responseTokens
        );
      }

      // Audit line: timestamp (via logger), model, token count and runId, so
      // quota consumption is reconstructable from logs as well as run history.
      logger.info({
        message: "Gemini call",
        runId,
        attemptIndex,
        model,
        promptTokens: result.promptTokens,
        responseTokens: result.responseTokens,
        thoughtTokens: result.thoughtTokens,
        totalTokens: result.totalTokens,
        finishReason: result.finishReason,
        latencyMs: result.latencyMs,
        retries,
        queuedMs,
        dailyUsed: reservation.used,
        dailyCap: reservation.cap
      });

      return result;
    }

    const detail = (await res.text()).slice(0, 400);

    // Permanent conditions — retrying cannot help and substituting a model is
    // exactly what this client refuses to do.
    if (res.status === 404 || (res.status === 429 && isPermanentQuotaError(detail))) {
      logger.error({
        message: "Pinned Gemini model unavailable — failing run, not substituting",
        runId,
        model,
        status: res.status,
        quotaLimit: parseQuotaLimit(detail),
        detail
      });
      throw new ModelUnavailableError(model, res.status, detail);
    }

    // Transient — back off and retry the SAME model.
    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`Gemini ${res.status}: ${detail}`);
      if (attempt < BACKOFF_MS.length) {
        retries += 1;
        logger.warn({
          message: "Gemini transient error, backing off (same model)",
          runId,
          model,
          status: res.status,
          quotaLimit: parseQuotaLimit(detail),
          backoffMs: BACKOFF_MS[attempt]
        });
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      break;
    }

    // 4xx that is not 404/429: a malformed request. Retrying is pointless.
    throw new Error(`Gemini request failed [${res.status}]: ${detail}`);
  }

  throw new Error(
    `Gemini call failed after ${retries} retries against pinned model "${model}": ` +
      (lastError ? lastError.message : "unknown error")
  );
}

module.exports = {
  generate,
  ResponseTruncatedError,
  parseQuotaLimit,
  isPermanentQuotaError,
  ModelUnavailableError,
  BACKOFF_MS
};
