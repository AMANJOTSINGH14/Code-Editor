const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

/**
 * UI verification for the Agent Runner (/runs).
 *
 * Costs no Gemini quota: DEMO_CACHE is on, so triggering a run replays a
 * previous one from Mongo. Screenshots land in ../verification/.
 */

const OUT = path.resolve(__dirname, "../verification");
const API = "http://localhost:3001";
const APP = "http://localhost:3000";

fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];

test.beforeEach(async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
});

test("agent runner UI", async ({ page }) => {
  // Use the app's own registration flow. Seeding localStorage directly does not
  // work here: AuthProvider reads the token during its initial mount, so a value
  // written afterwards is never picked up and the guard bounces to /login.
  const { registerAndLogin } = require("./helpers");
  await registerAndLogin(page, { email: `uiverify${Date.now()}@test.com` });

  // ---- run list ----
  await page.goto(`${APP}/runs`);
  await page.waitForSelector("text=Agent Runs", { timeout: 20000 });
  // Wait for the list to populate rather than screenshotting the spinner.
  await page.waitForSelector("text=/attempt/", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "01-run-list.png"), fullPage: true });

  // ---- trigger control ----
  // Select by value, not by label: the task's display name has changed twice
  // and a stale label silently selected the WRONG task, producing screenshots
  // of a different run entirely.
  const select = page.locator("select").first();
  const selfCorrection = await page
    .locator("select option")
    .filter({ hasText: /deployment services/i })
    .first()
    .getAttribute("value")
    .catch(() => null);
  if (selfCorrection) await select.selectOption(selfCorrection);
  await page.screenshot({ path: path.join(OUT, "02-trigger-control.png"), fullPage: true });

  // ---- detail view ----
  // Navigate to a specific run known to have self-corrected, rather than firing
  // a fresh one. Triggering here would cost Gemini quota AND is non-deterministic:
  // the agent sometimes solves it in one attempt, leaving no diff to screenshot.
  const DEMO_RUN = process.env.DEMO_RUN_ID;
  if (DEMO_RUN) {
    await page.goto(`${APP}/runs/${DEMO_RUN}`);
  } else {
    await page.getByRole("button", { name: /Trigger run/i }).click();
    await page.waitForURL(/\/runs\/[a-f0-9]{24}/, { timeout: 25000 });
  }
  await page.waitForTimeout(3000);

  // ---- detail: live log + status ----
  await page.screenshot({ path: path.join(OUT, "03-run-detail-live-log.png"), fullPage: true });

  // ---- attempt accordion: expand attempt 2 and open the diff ----
  const attemptRows = page.locator("button", { hasText: /^(exit|timed out|running)/ });
  const rowCount = await attemptRows.count();

  // Attempts render collapsed except the last; make sure at least one is open.
  if (rowCount > 0) {
    await attemptRows.first().click().catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(OUT, "04-attempt-accordion.png"), fullPage: true });

  // The diff tab only exists from attempt 2 onward.
  const diffTab = page.locator("button", { hasText: /diff vs attempt/i }).first();
  if (await diffTab.count()) {
    await diffTab.click();
    // Monaco needs a moment to mount and lay out.
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, "05-attempt-diff.png"), fullPage: true });
  } else {
    fs.writeFileSync(
      path.join(OUT, "05-attempt-diff-MISSING.txt"),
      "No 'diff vs attempt' tab was present — the run had fewer than 2 attempts with code."
    );
  }

  // ---- artifacts ----
  const artifactPanel = page.locator("text=Artifacts").first();
  await artifactPanel.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "06-artifacts.png"), fullPage: true });

  const downloadBtn = page.getByRole("button", { name: /Download/i }).first();
  if (await downloadBtn.count()) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
      downloadBtn.click()
    ]);
    if (download) {
      const target = path.join(OUT, `downloaded-${download.suggestedFilename()}`);
      await download.saveAs(target);
      fs.writeFileSync(
        path.join(OUT, "07-download-result.txt"),
        `downloaded: ${download.suggestedFilename()}\ncontents:\n${fs.readFileSync(target, "utf8")}`
      );
    }
  }

  fs.writeFileSync(
    path.join(OUT, "console-errors.txt"),
    consoleErrors.length ? consoleErrors.join("\n") : "(no console errors)"
  );
});
