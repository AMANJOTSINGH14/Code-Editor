const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

/**
 * Browser verification of the two new editor tabs.
 *
 * The API for both was already proven with curl; what is unproven is whether
 * the panels actually render and behave when a human clicks them. That is the
 * gap this closes.
 */

const OUT = path.resolve(__dirname, "../../verification");
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];

// Deliberately buggy: an off-by-one that yields NaN, and a max() that breaks on
// all-negative input. Both are provable by execution, which is the point.
//
// Written with NO leading whitespace on purpose. Monaco auto-indents after every
// `{`, so typing source that already carries its own indentation compounds line
// by line until the braces no longer balance — the first run of this test
// produced a SyntaxError instead of the intended assertion failure, which proved
// the panel worked but demonstrated the wrong thing. Letting the editor supply
// the indentation keeps the typed program valid.
const BUGGY = [
  "function average(nums) {",
  "let total = 0;",
  "for (let i = 0; i <= nums.length; i++) {",
  "total += nums[i];",
  "}",
  "return total / nums.length;",
  "}",
  "",
  "function largest(nums) {",
  "let best = 0;",
  "for (const n of nums) {",
  "if (n > best) best = n;",
  "}",
  "return best;",
  "}",
  "",
  "console.log('average', average([10, 20, 30]));",
  "console.log('largest', largest([-10, -5, -20]));"
].join("\n");

test("editor Run and Verify tabs", async ({ page }) => {
  test.setTimeout(240000);

  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const { registerAndLogin } = require("./helpers");
  await registerAndLogin(page, { email: `rv${Date.now()}@test.com` });

  // A JavaScript document — the sandbox image has no other toolchain.
  await page.getByPlaceholder("Document title").fill(`Run+Verify ${Date.now()}`);
  await page.locator("select").first().selectOption("javascript");
  await page.getByRole("button", { name: /create document/i }).click();
  await page.waitForURL(/\/editor\//, { timeout: 30000 });

  // Monaco needs to mount before it will accept keystrokes.
  await page.waitForSelector(".monaco-editor", { timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.locator(".monaco-editor").first().click();

  // Clear until the buffer is genuinely empty, then verify it.
  // A single Ctrl+A/Delete is not reliable here: the document is created with
  // starter content and is Yjs-backed, so a late CRDT sync can reinstate a
  // character after the delete. That left one stray "}" behind the insert and
  // produced a SyntaxError that had nothing to do with the planted bugs.
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(400);
    const left = (await page.locator(".monaco-editor .view-lines").first().innerText()).trim();
    if (!left) break;
  }
  await page.waitForTimeout(500);
  // insertText, not type(): Monaco auto-closes braces, so typing "{" also
  // inserts "}" and the subsequent typed "}" compounds — the first two runs of
  // this test produced unbalanced braces and a SyntaxError, which exercised the
  // panel but demonstrated the wrong failure. insertText behaves like a paste
  // and leaves the text exactly as written.
  await page.keyboard.insertText(BUGGY);
  await page.waitForTimeout(1500);

  // Monaco's auto-close-brackets still fires on the inserted "{" and appends a
  // matching "}" at the end of the buffer, leaving one surplus closing brace.
  // Trim from the end until the braces balance — otherwise the program is a
  // SyntaxError and both panels end up reporting on that instead of the two
  // bugs this test actually plants.
  for (let i = 0; i < 10; i += 1) {
    const text = await page.locator(".monaco-editor .view-lines").first().innerText();
    const opens = (text.match(/\{/g) || []).length;
    const closes = (text.match(/\}/g) || []).length;
    if (closes <= opens) break;
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1500);

  // ---------------- RUN TAB ----------------
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "10-run-tab-idle.png"), fullPage: true });

  // Confirm the editor actually holds the code before running — if the Monaco
  // typing silently failed, the API returns EMPTY_CODE and the panel shows an
  // error, which looks identical to "the feature is broken".
  // .view-lines holds only the code; .monaco-editor also contains the gutter,
  // so its innerText interleaves line NUMBERS with the source and any brace
  // count taken from it is meaningless.
  const editorText = await page.locator(".monaco-editor .view-lines").first().innerText();
  fs.writeFileSync(path.join(OUT, "editor-content-check.txt"), editorText);
  expect(editorText).toContain("average");
  // Guard against the auto-indent mangling recurring: if the braces no longer
  // balance, the program is a SyntaxError and every downstream result is about
  // the wrong thing.
  const opens = (editorText.match(/\{/g) || []).length;
  const closes = (editorText.match(/\}/g) || []).length;
  expect(opens).toBe(closes);

  await page.getByRole("button", { name: /Run code/i }).click();

  // Wait for a real terminal state rather than a fixed sleep: container create
  // + execute + destroy varies, and a short sleep produces a false failure.
  const runPanelLocator = page.locator("div.rounded-2xl", { hasText: "Run" }).last();
  await page
    .waitForSelector("text=/exit \\d|TIMED OUT|Cannot run|not enabled|Failed to run/", {
      timeout: 90000
    })
    .catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, "11-run-tab-result.png"), fullPage: true });

  const runPanel = await runPanelLocator.innerText().catch(() => null);
  fs.writeFileSync(path.join(OUT, "run-tab-outcome.txt"), String(runPanel));

  // ---------------- VERIFY TAB ----------------
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "12-verify-tab-idle.png"), fullPage: true });

  await page.getByRole("button", { name: /Prove & fix a bug/i }).click();

  // Wait for a terminal outcome rather than a fixed sleep — the loop is 1-3
  // Gemini calls plus sandbox runs and its duration varies a lot.
  await page
    .waitForSelector("text=/Bug proven and fixed|No provable bug|fix failed/", { timeout: 180000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "13-verify-tab-result.png"), fullPage: true });

  const verifyPanel = page.locator("div.rounded-2xl", { hasText: "Verify" }).last();
  const verdict = await verifyPanel.innerText().catch(() => null);
  fs.writeFileSync(path.join(OUT, "verify-tab-outcome.txt"), String(verdict));

  fs.writeFileSync(
    path.join(OUT, "editor-console-errors.txt"),
    consoleErrors.length ? consoleErrors.join("\n") : "(no console errors)"
  );

  // The panels must reach a real conclusion, not merely render. Asserting on the
  // panel TEXT (rather than a bare non-null) means a panel stuck on its spinner
  // fails the test instead of quietly passing.
  expect(runPanel).toMatch(/exit \d|TIMED OUT/);
  expect(verdict).toMatch(/Bug proven and fixed|No provable bug|fix failed/);
});
