// @ts-check
const { test, expect } = require("@playwright/test");
const { registerAndLogin, createDocument, login } = require("./helpers");

test.use({ storageState: { cookies: [], origins: [] } });

const UNIQUE = Date.now();
let user;
let editorUrl;

test.describe("Version History", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    user = await registerAndLogin(page, {
      name: "Version Tester",
      email: `versions_${UNIQUE}@e2e.test`,
      password: "Password123!"
    });
    const result = await createDocument(page, { title: `Version Doc ${UNIQUE}` });
    editorUrl = `/editor/${result.docId}`;
    // Type some code so snapshots aren't empty
    await page.waitForSelector(".monaco-editor", { timeout: 25000 });
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.type("const hello = 'world';");
    await page.waitForTimeout(1000);
    await context.close();
  });

  test("Versions tab is present and shows Version History heading", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /^versions$/i }).click();
    await expect(page.getByText(/version history/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /^save$/i })).toBeVisible({ timeout: 5000 });
  });

  test("shows empty state for a fresh document with no versions", async ({ page }) => {
    // Create a brand-new doc in this test to guarantee zero versions
    await login(page, { email: user.email, password: user.password });
    const { docId } = await createDocument(page, { title: `Empty Versions ${UNIQUE}` });
    await page.goto(`/editor/${docId}`);
    await page.getByRole("button", { name: /^versions$/i }).click();
    // "No versions yet. Save your first version above."
    await expect(page.getByText(/no versions yet/i)).toBeVisible({ timeout: 10000 });
  });

  test("version label input has correct placeholder", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /^versions$/i }).click();
    await expect(page.getByPlaceholder(/version label/i)).toBeVisible({ timeout: 5000 });
  });

  test("can save a version with a label", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /^versions$/i }).click();

    await page.getByPlaceholder(/version label/i).fill(`v1.0 Release ${UNIQUE}`);
    await page.getByRole("button", { name: /^save$/i }).click();

    // Either the cooldown timer ("10s") OR the label appear — both are valid success signals.
    // Use .first() to avoid strict-mode violation when both are in DOM simultaneously.
    await expect(
      page.locator("button").filter({ hasText: /^\d+s$/ })
        .or(page.getByText(`v1.0 Release ${UNIQUE}`))
        .first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("saved version appears in history list", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /^versions$/i }).click();

    const label = `Listed Version ${UNIQUE}`;
    await page.getByPlaceholder(/version label/i).fill(label);
    await page.getByRole("button", { name: /^save$/i }).click();

    // Version label div appears in the list
    await expect(page.getByText(label)).toBeVisible({ timeout: 15000 });
  });

  test("saved version has Preview and Restore buttons", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /^versions$/i }).click();

    const label = `Preview Version ${UNIQUE}`;
    await page.getByPlaceholder(/version label/i).fill(label);
    await page.getByRole("button", { name: /^save$/i }).click();

    // Wait for the version to appear in the list
    await expect(page.getByText(label)).toBeVisible({ timeout: 15000 });

    // Preview and Restore buttons are in the version card
    await expect(page.getByRole("button", { name: /^preview$/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /^restore$/i }).first()).toBeVisible({ timeout: 5000 });
  });
});
