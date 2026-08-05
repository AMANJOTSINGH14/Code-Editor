const config = require("../config");
const logger = require("../../utils/logger");
const AppError = require("../../utils/AppError");
const executor = require("../sandbox/executor");
const geminiClient = require("../agent/gemini.client");
const prompts = require("../agent/verify-prompts");
const { createRunBudget, BudgetExceededError, DailyCapExceededError } = require("../quota/budget");

/**
 * Verify-and-fix loop.
 *
 * This is what the AI reviewer cannot do. The reviewer reads code and produces
 * an opinion; nothing checks whether the opinion is true. Here every claim is
 * made falsifiable:
 *
 *   1. the model names a bug AND writes a test that fails because of it
 *   2. the test runs against the ORIGINAL code — if it passes, the "bug" was
 *      imaginary and we say so instead of reporting it
 *   3. the model's fix runs against the SAME test — if it passes, the fix is
 *      proven, not asserted
 *
 * Step 2 is the part that matters. A review that cannot be wrong is a review
 * that cannot be trusted, and this pipeline throws away claims it cannot
 * demonstrate.
 */

// Each cycle is one Gemini call plus up to two sandbox runs. Two is enough for
// "fix didn't work, try once more" without letting a confused model spend the
// whole daily quota on one button press.
const MAX_CYCLES = 3;

/**
 * Run a program built from an implementation plus the test block appended.
 * @param {string} implementation - Code under test.
 * @param {string} testCode - Assertions to append.
 * @param {string} runId - Label for the container.
 * @returns {Promise<Object>} Execution result.
 */
function runWithTest(implementation, testCode, runId) {
  const program = `${implementation}\n\n// ---- test ----\n${testCode}\n`;
  return executor.execute({
    runId,
    files: [{ name: "main.js", content: program }],
    entrypoint: "main.js"
  });
}

/**
 * Find a provable bug in the user's code and fix it.
 *
 * @param {Object} options - Options.
 * @param {string} options.code - The user's code.
 * @param {string} [options.language] - Language id.
 * @param {string} [options.userId] - For the audit log.
 * @param {(event: string, data: Object) => void} [options.onEvent] - Progress callback.
 * @returns {Promise<Object>} Verification result.
 */
async function verifyAndFix({ code, language = "javascript", userId = null, onEvent = () => {} }) {
  if (language !== "javascript") {
    throw new AppError(
      `Verify & Fix can only run javascript here — this sandbox image has no ${language} toolchain.`,
      400,
      "UNSUPPORTED_LANGUAGE"
    );
  }
  if (!code || !code.trim()) {
    throw new AppError("Nothing to verify — the editor is empty.", 400, "EMPTY_CODE");
  }
  if (Buffer.byteLength(code, "utf8") > config.sandbox.codeMaxBytes) {
    throw new AppError("Code is too large to verify.", 413, "CODE_TOO_LARGE");
  }

  const sessionId = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const budget = createRunBudget(MAX_CYCLES);
  const startedAt = Date.now();
  const cycles = [];

  let bug = "";
  let testCode = "";
  let fixedCode = "";
  let proof = null;
  let lastStderr = "";

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle += 1) {
    onEvent("status", { phase: cycle === 1 ? "analysing" : "refixing", cycle });

    // ---- ask the model -------------------------------------------------
    let parsed;
    try {
      budget.consume();
      const prompt =
        cycle === 1
          ? prompts.buildVerifyPrompt(code, language)
          : prompts.buildRefixPrompt({
              originalCode: code,
              testCode,
              fixedCode,
              stderr: lastStderr,
              cycle: cycle - 1,
              language
            });

      const generated = await geminiClient.generate({
        prompt,
        runId: sessionId,
        attemptIndex: cycle
      });
      parsed = prompts.parseVerifyResponse(generated.text);
    } catch (error) {
      if (error instanceof BudgetExceededError || error instanceof DailyCapExceededError) {
        throw new AppError(error.message, 429, error.code);
      }
      throw new AppError(`Model call failed: ${error.message}`, 502, "GENERATION_FAILED");
    }

    bug = parsed.bug;
    fixedCode = parsed.fixedCode;
    // The test is fixed after cycle 1 — it is the specification, and letting it
    // drift would let the model "fix" the code by weakening the check.
    if (cycle === 1) testCode = parsed.testCode;

    // ---- cycle 1 only: prove the bug is real ---------------------------
    if (cycle === 1) {
      onEvent("status", { phase: "proving", cycle });
      const before = await runWithTest(code, testCode, `${sessionId}-before`);
      proof = {
        exitCode: before.exitCode,
        timedOut: before.timedOut,
        stdout: before.stdout,
        stderr: before.stderr
      };

      // The test passed against the ORIGINAL code, so there is nothing to fix.
      // Reporting the "bug" anyway is exactly the failure mode this loop exists
      // to prevent.
      if (before.exitCode === 0 && !before.timedOut) {
        logger.info({ message: "Verify found no demonstrable bug", sessionId, userId });
        onEvent("status", { phase: "clean" });
        return {
          outcome: "no_bug_proven",
          bug,
          testCode,
          proof,
          fixedCode: null,
          cycles,
          geminiCalls: budget.used(),
          totalMs: Date.now() - startedAt,
          message:
            "The model proposed a bug, but its own test PASSED against your code — " +
            "so the claim could not be demonstrated and was discarded."
        };
      }
      onEvent("proof", { exitCode: before.exitCode, stderr: before.stderr });
    }

    // ---- run the fix against the same test -----------------------------
    onEvent("status", { phase: "verifying_fix", cycle });
    const after = await runWithTest(fixedCode, testCode, `${sessionId}-after-${cycle}`);
    lastStderr = after.stderr;

    cycles.push({
      cycle,
      fixedCode,
      exitCode: after.exitCode,
      timedOut: after.timedOut,
      stdout: after.stdout,
      stderr: after.stderr,
      passed: after.exitCode === 0 && !after.timedOut
    });

    onEvent("cycle", { cycle, passed: after.exitCode === 0 && !after.timedOut, exitCode: after.exitCode });

    if (after.exitCode === 0 && !after.timedOut) {
      logger.info({
        message: "Verify and fix succeeded",
        sessionId,
        userId,
        cycles: cycle,
        geminiCalls: budget.used()
      });
      onEvent("status", { phase: "fixed" });
      return {
        outcome: "fixed",
        bug,
        testCode,
        proof,
        fixedCode,
        cycles,
        geminiCalls: budget.used(),
        totalMs: Date.now() - startedAt
      };
    }

    if (!budget.hasRemaining()) break;
  }

  logger.warn({ message: "Verify could not produce a passing fix", sessionId, userId });
  onEvent("status", { phase: "unfixed" });
  return {
    outcome: "bug_proven_not_fixed",
    bug,
    testCode,
    proof,
    fixedCode,
    cycles,
    geminiCalls: budget.used(),
    totalMs: Date.now() - startedAt,
    message:
      `The bug was demonstrated, but ${MAX_CYCLES} fix attempts all failed the same test. ` +
      "The proof is still valid — the repair is not."
  };
}

module.exports = { verifyAndFix, MAX_CYCLES };
