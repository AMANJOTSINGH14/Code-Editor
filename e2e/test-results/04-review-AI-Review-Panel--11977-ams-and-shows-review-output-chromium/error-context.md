# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 04-review.spec.js >> AI Review Panel (Gemini Mock) >> Mock Gemini streams and shows review output
- Location: tests\04-review.spec.js:59:3

# Error details

```
TimeoutError: page.waitForSelector: Timeout 25000ms exceeded.
Call log:
  - waiting for locator('.monaco-editor') to be visible

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]: Failed to load document
  - paragraph [ref=e5]: The document may not exist or you may not have access.
  - button "Back to Dashboard" [ref=e6] [cursor=pointer]
```

# Test source

```ts
  1  | // @ts-check
  2  | const { test, expect } = require("@playwright/test");
  3  | const { registerAndLogin, createDocument, login } = require("./helpers");
  4  | 
  5  | test.use({ storageState: { cookies: [], origins: [] } });
  6  | 
  7  | const UNIQUE = Date.now();
  8  | let user;
  9  | let editorUrl;
  10 | 
  11 | test.describe("AI Review Panel (Gemini Mock)", () => {
  12 |   test.beforeAll(async ({ browser }) => {
  13 |     const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  14 |     const page = await context.newPage();
  15 |     user = await registerAndLogin(page, {
  16 |       name: "Review Tester",
  17 |       email: `review_${UNIQUE}@e2e.test`,
  18 |       password: "Password123!"
  19 |     });
  20 |     const { docId } = await createDocument(page, {
  21 |       title: `Review Doc ${UNIQUE}`,
  22 |       language: "javascript"
  23 |     });
  24 |     editorUrl = `/editor/${docId}`;
  25 |     // Type some code so the CRDT room has content — required for mock Gemini to stream
  26 |     await page.waitForSelector(".monaco-editor", { timeout: 25000 });
  27 |     await page.locator(".monaco-editor .view-lines").first().click();
  28 |     await page.keyboard.type("function add(a, b) { return a + b; }\nconsole.log(add(1, 2));");
  29 |     await page.waitForTimeout(1500); // let CRDT sync
  30 |     await context.close();
  31 |   });
  32 | 
  33 |   /** Helper: navigate to editor, switch to AI Review tab, wait for Monaco */
  34 |   async function openReview(page) {
  35 |     await login(page, { email: user.email, password: user.password });
  36 |     await page.goto(editorUrl);
> 37 |     await page.waitForSelector(".monaco-editor", { timeout: 25000 });
     |                ^ TimeoutError: page.waitForSelector: Timeout 25000ms exceeded.
  38 |     await page.getByRole("button", { name: /^ai review$/i }).click();
  39 |     await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible({ timeout: 8000 });
  40 |   }
  41 | 
  42 |   test("AI Review tab is present and clickable", async ({ page }) => {
  43 |     await openReview(page);
  44 |     await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible();
  45 |   });
  46 | 
  47 |   test("shows placeholder before any review is run", async ({ page }) => {
  48 |     await openReview(page);
  49 |     await expect(page.getByText(/click.*review my code/i)).toBeVisible({ timeout: 5000 });
  50 |   });
  51 | 
  52 |   test("Review My Code button triggers loading state", async ({ page }) => {
  53 |     await openReview(page);
  54 |     await page.getByRole("button", { name: /review my code/i }).click();
  55 |     // Button text changes to "Reviewing..." while the SSE stream is active
  56 |     await expect(page.getByRole("button", { name: /reviewing\.\.\./i })).toBeVisible({ timeout: 10000 });
  57 |   });
  58 | 
  59 |   test("Mock Gemini streams and shows review output", async ({ page }) => {
  60 |     await openReview(page);
  61 |     await page.getByRole("button", { name: /review my code/i }).click();
  62 |     // Mock returns "## Mock AI Review" — wait for any part of it
  63 |     await expect(page.getByText(/mock ai review|mock review|strengths|issues found/i))
  64 |       .toBeVisible({ timeout: 30000 });
  65 |   });
  66 | 
  67 |   test("Stop button appears while reviewing and can stop it", async ({ page }) => {
  68 |     await openReview(page);
  69 |     await page.getByRole("button", { name: /review my code/i }).click();
  70 | 
  71 |     // Mock streams at 60ms/word — enough time to catch the Stop button
  72 |     const stopBtn = page.getByRole("button", { name: /^stop$/i });
  73 |     await expect(stopBtn).toBeVisible({ timeout: 10000 });
  74 |     await stopBtn.click();
  75 | 
  76 |     // After stop, Review My Code button returns
  77 |     await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible({ timeout: 8000 });
  78 |   });
  79 | 
  80 |   test("review button is disabled while reviewing is in progress", async ({ page }) => {
  81 |     await openReview(page);
  82 |     await page.getByRole("button", { name: /review my code/i }).click();
  83 |     // During streaming the button label is "Reviewing..." and is disabled
  84 |     await expect(page.getByRole("button", { name: /reviewing\.\.\./i })).toBeDisabled({ timeout: 10000 });
  85 |   });
  86 | 
  87 |   test("empty editor shows 'Nothing to review yet' message", async ({ page }) => {
  88 |     await login(page, { email: user.email, password: user.password });
  89 |     // Create a NEW empty doc so CRDT has no content
  90 |     const { docId } = await createDocument(page, { title: `Empty For Review ${UNIQUE}` });
  91 |     await page.goto(`/editor/${docId}`);
  92 |     await page.waitForSelector(".monaco-editor", { timeout: 25000 });
  93 |     await page.getByRole("button", { name: /^ai review$/i }).click();
  94 |     await page.getByRole("button", { name: /review my code/i }).click();
  95 |     // Empty doc → server returns "Nothing to review yet."
  96 |     await expect(page.getByText(/nothing to review yet/i)).toBeVisible({ timeout: 15000 });
  97 |   });
  98 | });
  99 | 
```