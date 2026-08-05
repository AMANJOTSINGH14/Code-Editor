/**
 * Versioned prompt templates for the agent loop.
 *
 * Everything the model is told lives in this one file. PROMPT_VERSION is stamped
 * onto every persisted attempt, so a run recorded months ago stays interpretable
 * after the template changes — without it, old attempt history silently becomes
 * evidence about a prompt that no longer exists.
 *
 * Bump the version on any change to the templates below.
 */

// 1.0.0 -> 2.0.0  removed the "stdlib only, no npm" rule from the initial
//                 prompt, so the agent must discover its dependency set by
//                 running code rather than being told.
// 2.0.0 -> 2.1.0  the CORRECTION prompt's guidance assumed every failure was
//                 data-shaped ("if the data is malformed..."). Against a
//                 missing-module error the model kept re-requiring the same
//                 absent package, so the loop could not converge. Correction
//                 guidance is now root-cause agnostic and states that the
//                 environment is fixed. This is not a spoiler: it is only ever
//                 shown AFTER a real failure whose stderr already revealed it.
// 2.1.0 -> 3.0.0  added a THIRD failure class. Previously a correction prompt
//                 could only describe a crash or a timeout, so a run that
//                 exited 0 with wrong output had no way to be corrected at all —
//                 it was simply recorded as succeeded. Corrections now carry
//                 exact expected-vs-actual mismatches from the validator.
const PROMPT_VERSION = "3.0.0";

// NOTE — what is deliberately NOT stated here.
//
// An earlier version told the model "Node standard library ONLY, no npm, any
// third-party require will fail". That is true of the sandbox, and stating it
// made attempt 1 succeed almost every time.
//
// It also made the self-correction demo hollow. Discovering the environment's
// real constraints by running code and reading the error is the entire
// behaviour being demonstrated; handing the model that constraint up front
// removes the only thing worth showing. So the available-dependency set is now
// something the agent finds out the way an engineer would — by requiring a
// package, getting MODULE_NOT_FOUND, and rewriting.
//
// Everything still listed below is either unobservable from inside a failing
// run (paths, limits) or a fact the model cannot act on wrongly (no network).
const ENVIRONMENT_RULES = `EXECUTION ENVIRONMENT — these are hard constraints:
- Node.js 20, run as: node /workspace/main.js
- The container has NO network access at runtime.
- Input files are in /workspace/ (read them with fs, relative to /workspace).
- Write output files to /workspace/out/ — this directory already exists.
- The filesystem is read-only except /workspace and /tmp.
- Your program must exit 0 on success and non-zero on failure.
- Wall-clock limit: 30 seconds. No infinite loops, no waiting on input.
- Print meaningful progress to stdout, and real diagnostics to stderr.`;

const OUTPUT_CONTRACT = `RESPONSE FORMAT — follow exactly:

### PLAN
<2-4 sentences: your approach, and the edge cases you are handling>

### CODE
\`\`\`javascript
<the complete contents of main.js — no placeholders, no TODOs, no ellipses>
\`\`\`

Emit nothing after the closing fence.`;

/**
 * Build the prompt for the first attempt.
 * @param {Object} task - The AgentTask.
 * @returns {string} Prompt text.
 */
function buildInitialPrompt(task) {
  const fixtureList = (task.fixtures || [])
    .map((f) => `- /workspace/${f.name}`)
    .join("\n");

  // task.description is deliberately NOT included.
  //
  // It is operator-facing metadata shown in the run UI, written for humans
  // reading the task list — which means it routinely explains WHY a task exists
  // rather than what to do. Interpolating it leaked the entire self-correction
  // demo into the prompt ("the natural solution requires js-yaml, which the
  // sandbox does not have"), so the model skipped the dependency it was
  // supposed to discover and attempt 1 passed. Only `prompt` is the model's
  // instruction; everything else on the task is for people.
  return `You are an autonomous coding agent. Write a complete Node.js program that accomplishes the task below.

TASK: ${task.name}

${task.prompt}

${fixtureList ? `INPUT FILES AVAILABLE:\n${fixtureList}\n` : ""}
${task.expectedArtifacts && task.expectedArtifacts.length
      ? `EXPECTED OUTPUT FILES (write these into /workspace/out/):\n${task.expectedArtifacts
          .map((a) => `- ${a}`)
          .join("\n")}\n`
      : ""}
${ENVIRONMENT_RULES}

${OUTPUT_CONTRACT}`;
}

/**
 * Build the correction prompt after a failed attempt.
 *
 * The model is given the exact code it produced plus the REAL stderr and exit
 * code from the sandbox — never a summary. Reading actual diagnostics is the
 * entire mechanism being demonstrated; paraphrasing them into "it failed" would
 * make the self-correction indistinguishable from a re-roll.
 *
 * Output is capped because a failing program can emit far more stderr than fits
 * usefully in a prompt, and the tail holds the actual error.
 * @param {Object} task - The AgentTask.
 * @param {Object} failure - Previous attempt result.
 * @param {string} failure.code - Code that was run.
 * @param {string} failure.stderr - Captured stderr.
 * @param {string} failure.stdout - Captured stdout.
 * @param {number|null} failure.exitCode - Exit code.
 * @param {boolean} failure.timedOut - Whether it hit the wall clock.
 * @param {number} failure.attemptIndex - Which attempt failed.
 * @returns {string} Prompt text.
 */
function buildCorrectionPrompt(task, failure) {
  const tail = (text, max) => {
    const value = text || "";
    return value.length > max ? `...[truncated]...\n${value.slice(-max)}` : value;
  };

  // Three distinct failure classes. Naming which one occurred matters: the fix
  // for a missing module, a crash, and a wrong answer are completely different,
  // and a generic "it failed" sends the model rewriting at random.
  let diagnosis;
  if (failure.validationFailures && failure.validationFailures.length) {
    diagnosis =
      "The program RAN SUCCESSFULLY and exited 0, but the output it produced is " +
      "WRONG. The logic is incorrect — this is not a crash and not a missing " +
      "dependency. Below are the exact values that did not match.";
  } else if (failure.timedOut) {
    diagnosis =
      "The program was KILLED after exceeding the 30 second wall-clock limit. It " +
      "did not exit on its own — most likely an infinite loop, an unbounded read, " +
      "or waiting on something that never arrives.";
  } else {
    diagnosis = `The program exited with code ${failure.exitCode}, which means it FAILED.`;
  }

  return `You are an autonomous coding agent. Your previous attempt failed. Fix it.

TASK: ${task.name}
${task.prompt}

--- ATTEMPT ${failure.attemptIndex} — THE CODE YOU WROTE ---
\`\`\`javascript
${failure.code}
\`\`\`

--- ATTEMPT ${failure.attemptIndex} — WHAT ACTUALLY HAPPENED ---
${diagnosis}

STDERR:
\`\`\`
${tail(failure.stderr, 4000) || "(empty)"}
\`\`\`

STDOUT:
\`\`\`
${tail(failure.stdout, 1000) || "(empty)"}
\`\`\`
${
  failure.validationSummary
    ? `\n--- OUTPUT CHECK RESULTS ---\n${failure.validationSummary}\n`
    : ""
}
--- YOUR JOB ---
Read the error above carefully and identify the ACTUAL root cause. Do not guess,
and do not simply reformat the previous code.

The environment is FIXED and you cannot change it. You cannot install packages,
add dependencies, run a package manager, or reach the network. If the error says
a module cannot be found, that module does not exist and never will — re-requiring
it, requiring a different third-party package, or wrapping the require in
try/catch will all fail the same way. The only fix is to REIMPLEMENT that
functionality yourself using what is already available in the runtime.

If instead the error is about the data — malformed input, a missing field, a
zero denominator — handle those cases explicitly rather than assuming clean input.

If the OUTPUT CHECK RESULTS section is present, the program ran fine and your
PARSING LOGIC is wrong. Do not rewrite it from scratch and hope. Work out, for
each listed mismatch, exactly which input lines should have produced the expected
value and why your code produced something else — then fix that specific step.
Re-read the format rules in the task; they define precisely what counts.

Return a COMPLETE corrected program — not a diff, not a patch, not a fragment.

${ENVIRONMENT_RULES}

${OUTPUT_CONTRACT}`;
}

/**
 * Parse the model's response into plan and code.
 *
 * A delimited format is used instead of JSON on purpose: JSON containing a
 * program requires the model to escape every quote, backslash and newline in
 * the code, and it gets that wrong often enough to fail runs for reasons that
 * have nothing to do with the task. Fenced blocks survive that.
 *
 * Parsing is deliberately lenient — a response that is *only* code, with no
 * headings, still yields a usable program rather than failing the run.
 * @param {string} text - Raw model response.
 * @returns {{plan: string, code: string}} Parsed result.
 * @throws {Error} When no code can be recovered.
 */
function parseResponse(text) {
  const raw = text || "";

  let plan = "";
  const planMatch = /###\s*PLAN\s*\n([\s\S]*?)(?=###\s*CODE|```|$)/i.exec(raw);
  if (planMatch) plan = planMatch[1].trim();

  // Prefer a javascript-tagged fence, then any fence, then the whole response.
  let code = "";
  const jsFence = /```(?:javascript|js|node)\s*\n([\s\S]*?)```/i.exec(raw);
  if (jsFence) {
    code = jsFence[1];
  } else {
    const anyFence = /```[a-zA-Z]*\s*\n([\s\S]*?)```/.exec(raw);
    if (anyFence) {
      code = anyFence[1];
    } else if (!/###\s*CODE/i.test(raw) && raw.trim()) {
      // No fences at all — treat the response as the program.
      code = raw;
    }
  }

  code = code.trim();
  if (!code) {
    throw new Error(
      `Could not extract code from the model response (${raw.length} chars). ` +
        `Response began: ${raw.slice(0, 200)}`
    );
  }

  return { plan: plan || "(no plan provided)", code };
}

module.exports = {
  PROMPT_VERSION,
  buildInitialPrompt,
  buildCorrectionPrompt,
  parseResponse,
  ENVIRONMENT_RULES,
  OUTPUT_CONTRACT
};
