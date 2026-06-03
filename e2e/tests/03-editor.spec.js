// @ts-check
const { test, expect } = require("@playwright/test");
const { registerAndLogin, createDocument, login } = require("./helpers");

test.use({ storageState: { cookies: [], origins: [] } });

const UNIQUE = Date.now();
let user;
let editorUrl;

test.describe("Editor", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    user = await registerAndLogin(page, {
      name: "Editor Tester",
      email: `editor_${UNIQUE}@e2e.test`,
      password: "Password123!"
    });
    const { docId } = await createDocument(page, { title: `Editor Test Doc ${UNIQUE}` });
    editorUrl = `/editor/${docId}`;
    await context.close();
  });

  test("editor page loads with document title", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await expect(page.getByText(`Editor Test Doc ${UNIQUE}`)).toBeVisible({ timeout: 15000 });
  });

  test("shows Live/Offline connection status badge", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await expect(page.locator("text=/Live|Offline/")).toBeVisible({ timeout: 10000 });
  });

  test("Monaco editor is rendered", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 25000 });
  });

  test("tab bar shows Chat, AI Review, Versions tabs", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await expect(page.getByRole("button", { name: /^chat$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^ai review$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^versions$/i })).toBeVisible();
  });

  test("switching to AI Review tab shows the review panel", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /^ai review$/i }).click();
    // Use role selector to avoid strict-mode violation (button vs placeholder text)
    await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible({ timeout: 10000 });
  });

  test("switching to Versions tab shows the versions panel", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /^versions$/i }).click();
    // The VersionHistory component shows "Version History" heading and a "Save" button
    await expect(page.getByText(/version history/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /^save$/i })).toBeVisible({ timeout: 5000 });
  });

  test("language selector is visible in header", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    const langSelector = page.locator("select, [role='combobox']").first();
    await expect(langSelector).toBeVisible({ timeout: 10000 });
  });

  test("Share button opens share modal", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /share/i }).click();
    await expect(page.getByText(/copy|share link/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("Back button returns to dashboard", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.getByRole("button", { name: /← back/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test("Make Public / Make Private toggle is visible", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    const toggleBtn = page.getByRole("button", { name: /make (public|private)/i });
    await expect(toggleBtn).toBeVisible({ timeout: 10000 });
  });

  test("visibility toggle changes button label", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);

    const toggleBtn = page.getByRole("button", { name: /make (public|private)/i });
    const initialText = await toggleBtn.innerText();
    await toggleBtn.click();

    await expect(page.getByRole("button", {
      name: initialText.includes("Public") ? /make private/i : /make public/i
    })).toBeVisible({ timeout: 10000 });
  });
});
