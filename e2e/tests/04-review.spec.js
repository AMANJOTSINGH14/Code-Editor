// @ts-check
const { test, expect } = require("@playwright/test");
const { registerAndLogin, createDocument, login } = require("./helpers");

test.use({ storageState: { cookies: [], origins: [] } });

const UNIQUE = Date.now();
let user;
let editorUrl;

test.describe("AI Review Panel (Gemini Mock)", () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    user = await registerAndLogin(page, {
      name: "Review Tester",
      email: `review_${UNIQUE}@e2e.test`,
      password: "Password123!"
    });
    const { docId } = await createDocument(page, {
      title: `Review Doc ${UNIQUE}`,
      language: "javascript"
    });
    editorUrl = `/editor/${docId}`;
    // Type some code so the CRDT room has content — required for mock Gemini to stream
    await page.waitForSelector(".monaco-editor", { timeout: 25000 });
    await page.locator(".monaco-editor .view-lines").first().click();
    await page.keyboard.type("function add(a, b) { return a + b; }\nconsole.log(add(1, 2));");
    await page.waitForTimeout(1500); // let CRDT sync
    await context.close();
  });

  /** Helper: navigate to editor, switch to AI Review tab, wait for Monaco */
  async function openReview(page) {
    await login(page, { email: user.email, password: user.password });
    await page.goto(editorUrl);
    await page.waitForSelector(".monaco-editor", { timeout: 25000 });
    await page.getByRole("button", { name: /^ai review$/i }).click();
    await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible({ timeout: 8000 });
  }

  test("AI Review tab is present and clickable", async ({ page }) => {
    await openReview(page);
    await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible();
  });

  test("shows placeholder before any review is run", async ({ page }) => {
    await openReview(page);
    await expect(page.getByText(/click.*review my code/i)).toBeVisible({ timeout: 5000 });
  });

  test("Review My Code button triggers loading state", async ({ page }) => {
    await openReview(page);
    await page.getByRole("button", { name: /review my code/i }).click();
    // Button text changes to "Reviewing..." while the SSE stream is active
    await expect(page.getByRole("button", { name: /reviewing\.\.\./i })).toBeVisible({ timeout: 10000 });
  });

  test("Mock Gemini streams and shows review output", async ({ page }) => {
    await openReview(page);
    await page.getByRole("button", { name: /review my code/i }).click();
    // Mock returns "## Mock AI Review" — wait for any part of it
    await expect(page.getByText(/mock ai review|mock review|strengths|issues found/i))
      .toBeVisible({ timeout: 30000 });
  });

  test("Stop button appears while reviewing and can stop it", async ({ page }) => {
    await openReview(page);
    await page.getByRole("button", { name: /review my code/i }).click();

    // Mock streams at 60ms/word — enough time to catch the Stop button
    const stopBtn = page.getByRole("button", { name: /^stop$/i });
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    await stopBtn.click();

    // After stop, Review My Code button returns
    await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible({ timeout: 8000 });
  });

  test("review button is disabled while reviewing is in progress", async ({ page }) => {
    await openReview(page);
    await page.getByRole("button", { name: /review my code/i }).click();
    // During streaming the button label is "Reviewing..." and is disabled
    await expect(page.getByRole("button", { name: /reviewing\.\.\./i })).toBeDisabled({ timeout: 10000 });
  });

  test("empty editor shows 'Nothing to review yet' message", async ({ page }) => {
    await login(page, { email: user.email, password: user.password });
    // Create a NEW empty doc so CRDT has no content
    const { docId } = await createDocument(page, { title: `Empty For Review ${UNIQUE}` });
    await page.goto(`/editor/${docId}`);
    await page.waitForSelector(".monaco-editor", { timeout: 25000 });
    await page.getByRole("button", { name: /^ai review$/i }).click();
    await page.getByRole("button", { name: /review my code/i }).click();
    // Empty doc → server returns "Nothing to review yet."
    await expect(page.getByText(/nothing to review yet/i)).toBeVisible({ timeout: 15000 });
  });
});
