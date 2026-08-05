/**
 * Prompts for the verify-and-fix loop.
 *
 * Versioned separately from the agent-run prompts: the two loops solve
 * different problems and change for different reasons.
 */

const VERIFY_PROMPT_VERSION = "1.0.0";

const RULES = `EXECUTION ENVIRONMENT — hard constraints:
- Node.js 20. The program is run as: node /workspace/main.js
- Node standard library ONLY. No network, no npm, no third-party requires.
- Wall-clock limit 30 seconds.
- Use node:assert for checks. A failed assertion must make the process exit non-zero.`;

const CONTRACT = `RESPONSE FORMAT — follow exactly, all three sections:

### BUG
<2-4 sentences: the single most serious defect, and what input triggers it>

### TEST
\`\`\`javascript
<assertions ONLY. This block is appended BELOW the code under test, so every
function and variable it declares is already in scope. Do not redeclare them and
do not include the implementation. Use assert. It MUST fail against the buggy
code and pass against a correct one.>
\`\`\`

### FIX
\`\`\`javascript
<the COMPLETE corrected version of the code under test — same functions, same
names, same exports, with the defect repaired. No assertions here.>
\`\`\`

Emit nothing after the final fence.`;

/**
 * Ask for a bug, a failing test that proves it, and a fix.
 *
 * One call produces all three because they are one thought: a bug you cannot
 * write a failing test for is a guess, and a fix written without the test is
 * unverifiable. Splitting them across calls would triple the quota cost and let
 * the three drift out of agreement.
 * @param {string} code - The user's code.
 * @param {string} language - Language id.
 * @returns {string} Prompt text.
 */
function buildVerifyPrompt(code, language) {
  return `You are a senior engineer reviewing code. Find a REAL, demonstrable defect —
then prove it with a test that fails, and repair it.

Do not report style opinions, naming, or hypothetical concerns. Report only
something that produces provably wrong behaviour or a crash for some input, and
that your test can demonstrate by failing.

--- CODE UNDER TEST (${language}) ---
\`\`\`javascript
${code}
\`\`\`

Your TEST block will be appended directly below this code and executed. It must
FAIL now (because the bug is present) and PASS once the code is replaced by your
FIX.

${RULES}

${CONTRACT}`;
}

/**
 * Ask for a better fix after the previous one failed its own test.
 * @param {Object} failure - Previous cycle state.
 * @returns {string} Prompt text.
 */
function buildRefixPrompt({ originalCode, testCode, fixedCode, stderr, cycle, language }) {
  return `Your previous fix did not work. The test you wrote still fails against it.

--- ORIGINAL CODE (${language}) ---
\`\`\`javascript
${originalCode}
\`\`\`

--- YOUR TEST (unchanged — this is the specification) ---
\`\`\`javascript
${testCode}
\`\`\`

--- YOUR FIX FROM CYCLE ${cycle}, WHICH STILL FAILS ---
\`\`\`javascript
${fixedCode}
\`\`\`

--- WHAT HAPPENED WHEN TEST + FIX RAN TOGETHER ---
\`\`\`
${(stderr || "(no stderr)").slice(-3000)}
\`\`\`

Read the failure and work out which assertion is unsatisfied and why. Do NOT
change the test — it is the specification. Fix the implementation so the test
passes.

If your own test is wrong about the intended behaviour, say so in the BUG
section and correct the test — but only if it is genuinely wrong, not because
it is inconvenient.

${RULES}

${CONTRACT}`;
}

/**
 * Parse a bug / test / fix response.
 * @param {string} text - Raw model output.
 * @returns {{bug: string, testCode: string, fixedCode: string}} Parsed parts.
 * @throws {Error} When the test or fix block is missing.
 */
function parseVerifyResponse(text) {
  const raw = text || "";

  const bugMatch = /###\s*BUG\s*\n([\s\S]*?)(?=###\s*TEST|$)/i.exec(raw);
  const bug = bugMatch ? bugMatch[1].trim() : "";

  // Take fenced blocks positionally after their headings, so a fence inside the
  // BUG prose cannot be mistaken for the test.
  const section = (name) => {
    const re = new RegExp(`###\\s*${name}\\s*\\n[\\s\\S]*?\`\`\`(?:javascript|js)?\\s*\\n([\\s\\S]*?)\`\`\``, "i");
    const m = re.exec(raw);
    return m ? m[1].trim() : "";
  };

  const testCode = section("TEST");
  const fixedCode = section("FIX");

  if (!testCode) throw new Error("Model response contained no TEST block");
  if (!fixedCode) throw new Error("Model response contained no FIX block");

  return { bug: bug || "(no description given)", testCode, fixedCode };
}

module.exports = {
  VERIFY_PROMPT_VERSION,
  buildVerifyPrompt,
  buildRefixPrompt,
  parseVerifyResponse
};
