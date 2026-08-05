const config = require("../config");
const logger = require("../../utils/logger");
const AppError = require("../../utils/AppError");
const executor = require("../sandbox/executor");

/**
 * Ad-hoc code execution.
 *
 * Runs a snippet the USER wrote, rather than one the agent generated. Same
 * sandbox, same hardening, same limits — the executor does not care where the
 * program came from, which is exactly why this is a thin wrapper rather than a
 * second execution path.
 *
 * This is the piece that turns the editor from "somewhere you type" into
 * "somewhere you find out whether it works".
 */

// Only languages the sandbox image can actually run. Adding one means adding a
// toolchain to the image, not just a line here — so the list is deliberately
// short and honest about it.
const RUNTIMES = {
  javascript: { file: "main.js", entrypoint: "main.js" }
};

/**
 * Languages this deployment can execute.
 * @returns {string[]} Supported language ids.
 */
function supportedLanguages() {
  return Object.keys(RUNTIMES);
}

/**
 * Execute a user-supplied snippet in the sandbox.
 *
 * @param {Object} options - Execution options.
 * @param {string} options.code - Source to run.
 * @param {string} [options.language] - Language id.
 * @param {string} [options.userId] - For the audit log.
 * @returns {Promise<Object>} Execution result.
 * @throws {AppError} On unsupported language or oversized input.
 */
async function executeSnippet({ code, language = "javascript", userId = null }) {
  const runtime = RUNTIMES[language];
  if (!runtime) {
    throw new AppError(
      `Cannot run ${language} here — this sandbox image only has: ${supportedLanguages().join(", ")}.`,
      400,
      "UNSUPPORTED_LANGUAGE"
    );
  }

  if (!code || !code.trim()) {
    throw new AppError("Nothing to run — the editor is empty.", 400, "EMPTY_CODE");
  }

  const bytes = Buffer.byteLength(code, "utf8");
  if (bytes > config.sandbox.codeMaxBytes) {
    throw new AppError(
      `Code is ${bytes} bytes, over the ${config.sandbox.codeMaxBytes} byte limit.`,
      413,
      "CODE_TOO_LARGE"
    );
  }

  // Label with a synthetic id so these containers are still found by the boot
  // reaper alongside agent-run containers.
  const runId = `adhoc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const result = await executor.execute({
    runId,
    files: [{ name: runtime.file, content: code }],
    entrypoint: runtime.entrypoint
  });

  logger.info({
    message: "Ad-hoc snippet executed",
    runId,
    userId,
    language,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    codeBytes: bytes
  });

  return {
    ...result,
    language,
    // Wall-clock as seen by the caller, which includes container create/destroy
    // — a user watching a spinner cares about this, not just process time.
    totalMs: Date.now() - startedAt
  };
}

module.exports = { executeSnippet, supportedLanguages, RUNTIMES };
