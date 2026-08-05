const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");
const artifacts = require("../artifacts");

/**
 * Artifact validation.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Exit code 0 means "the program ran to completion". It does NOT mean the
 * output is right. Three separate live runs produced a zero exit, valid JSON,
 * and confidently wrong numbers — a summary claiming 3 replicas where the input
 * says 9, and services named after keys that were never services. Every one of
 * those was recorded as `succeeded`.
 *
 * A validator turns "the process completed" into "the answer is correct". A run
 * that fails validation is treated exactly like a non-zero exit: the specific
 * failed assertions are fed back and the agent gets another attempt. Wrong
 * output becomes a third correctable failure class alongside missing modules
 * and runtime errors.
 */

/**
 * Resolve a dotted path against a parsed artifact.
 *
 * Supports:
 *   - `a.b.c`                plain property access
 *   - `a.length`             array/string length
 *   - `a[key]`               on an ARRAY, the element whose `name` === key;
 *                            on an object, the property `key`
 *
 * The array-by-name form matters because the agent controls the ORDER of the
 * services array. Asserting `services[0]` would fail a correct answer that
 * happened to sort differently, which would teach the agent to chase a
 * non-requirement.
 * @param {*} root - Parsed artifact.
 * @param {string} expr - Path expression.
 * @returns {{ok: boolean, value: *}} Resolution result.
 */
function resolvePath(root, expr) {
  // Split "a.b[key].c" into ["a","b","[key]","c"]
  const parts = String(expr)
    .replace(/\[([^\]]+)\]/g, ".[$1]")
    .split(".")
    .filter(Boolean);

  let current = root;
  for (const raw of parts) {
    if (current === null || current === undefined) return { ok: false, value: undefined };

    const bracket = /^\[(.+)\]$/.exec(raw);
    if (bracket) {
      const key = bracket[1];
      if (Array.isArray(current)) {
        const found = current.find((item) => item && item.name === key);
        if (!found) return { ok: false, value: undefined };
        current = found;
        continue;
      }
      current = current[key];
      continue;
    }

    if (raw === "length" && (Array.isArray(current) || typeof current === "string")) {
      current = current.length;
      continue;
    }

    if (typeof current !== "object") return { ok: false, value: undefined };
    current = current[raw];
  }

  return { ok: true, value: current };
}

/**
 * Render a value compactly for a failure message.
 * @param {*} value - Value to render.
 * @returns {string} Display string.
 */
function show(value) {
  if (value === undefined) return "undefined (missing)";
  if (typeof value === "object") return JSON.stringify(value);
  return JSON.stringify(value);
}

/**
 * Validate a run's artifact against its task's assertions.
 *
 * @param {Object} task - The AgentTask (may carry `validator`).
 * @param {string} runId - Run id.
 * @returns {{applicable: boolean, passed: boolean, failures: Array, checked: number, reason?: string}} Validation result.
 */
function validateArtifact(task, runId) {
  const spec = task.validator;
  if (!spec || !Array.isArray(spec.assertions) || !spec.assertions.length) {
    // Tasks without a validator keep the old behaviour: exit 0 is success.
    return { applicable: false, passed: true, failures: [], checked: 0 };
  }

  const file = path.join(artifacts.localRunDir(runId), spec.artifactName);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    // A missing or unparseable artifact is a validation failure, not a crash —
    // the agent should get the chance to fix it.
    return {
      applicable: true,
      passed: false,
      checked: 0,
      failures: [
        {
          label: `artifact ${spec.artifactName}`,
          expected: "readable JSON",
          actual: error.code === "ENOENT" ? "file was not created" : `unparseable (${error.message})`
        }
      ]
    };
  }

  const failures = [];
  for (const assertion of spec.assertions) {
    const { value } = resolvePath(parsed, assertion.path);
    // Strict equality: these are numbers and booleans, so "3" must not pass an
    // assertion expecting 3. A stringified number is a real bug in the output.
    if (value !== assertion.equals) {
      failures.push({
        label: assertion.label || assertion.path,
        path: assertion.path,
        expected: assertion.equals,
        actual: value
      });
    }
  }

  logger.info({
    message: "Artifact validated",
    runId,
    artifact: spec.artifactName,
    checked: spec.assertions.length,
    failed: failures.length,
    passed: failures.length === 0
  });

  return {
    applicable: true,
    passed: failures.length === 0,
    checked: spec.assertions.length,
    failures
  };
}

/**
 * Render failures as feedback the model can act on.
 *
 * Deliberately concrete: "expected totalReplicas 9, got 3" tells the agent what
 * is wrong AND gives it a target. A bare "validation failed" would send it
 * rewriting at random.
 * @param {Array} failures - Failed assertions.
 * @param {number} checked - Total assertions evaluated.
 * @returns {string} Human/model-readable summary.
 */
function describeFailures(failures, checked) {
  const lines = failures.map(
    (f) => `  - ${f.label}: expected ${show(f.expected)}, got ${show(f.actual)}   [${f.path}]`
  );
  return `${failures.length} of ${checked} output checks FAILED:\n${lines.join("\n")}`;
}

module.exports = { validateArtifact, describeFailures, resolvePath };
