# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 03-editor.spec.js >> Editor >> switching to AI Review tab shows the review panel
- Location: tests\03-editor.spec.js:51:3

# Error details

```
TimeoutError: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /^ai review$/i })

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - heading "Welcome back" [level=1] [ref=e5]
  - paragraph [ref=e6]: Log in to continue collaborating.
  - generic [ref=e7]:
    - textbox "Email" [ref=e8]
    - textbox "Password" [ref=e9]
    - button "Sign in" [ref=e10] [cursor=pointer]
  - paragraph [ref=e11]:
    - text: New here?
    - link "Create an account" [ref=e12] [cursor=pointer]:
      - /url: /register
```

# Test source

```ts
  1   | // @ts-check
  2   | const { test, expect } = require("@playwright/test");
  3   | const { registerAndLogin, createDocument, login } = require("./helpers");
  4   | 
  5   | test.use({ storageState: { cookies: [], origins: [] } });
  6   | 
  7   | const UNIQUE = Date.now();
  8   | let user;
  9   | let editorUrl;
  10  | 
  11  | test.describe("Editor", () => {
  12  |   test.beforeAll(async ({ browser }) => {
  13  |     const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  14  |     const page = await context.newPage();
  15  |     user = await registerAndLogin(page, {
  16  |       name: "Editor Tester",
  17  |       email: `editor_${UNIQUE}@e2e.test`,
  18  |       password: "Password123!"
  19  |     });
  20  |     const { docId } = await createDocument(page, { title: `Editor Test Doc ${UNIQUE}` });
  21  |     editorUrl = `/editor/${docId}`;
  22  |     await context.close();
  23  |   });
  24  | 
  25  |   test("editor page loads with document title", async ({ page }) => {
  26  |     await login(page, { email: user.email, password: user.password });
  27  |     await page.goto(editorUrl);
  28  |     await expect(page.getByText(`Editor Test Doc ${UNIQUE}`)).toBeVisible({ timeout: 15000 });
  29  |   });
  30  | 
  31  |   test("shows Live/Offline connection status badge", async ({ page }) => {
  32  |     await login(page, { email: user.email, password: user.password });
  33  |     await page.goto(editorUrl);
  34  |     await expect(page.locator("text=/Live|Offline/")).toBeVisible({ timeout: 10000 });
  35  |   });
  36  | 
  37  |   test("Monaco editor is rendered", async ({ page }) => {
  38  |     await login(page, { email: user.email, password: user.password });
  39  |     await page.goto(editorUrl);
  40  |     await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 25000 });
  41  |   });
  42  | 
  43  |   test("tab bar shows Chat, AI Review, Versions tabs", async ({ page }) => {
  44  |     await login(page, { email: user.email, password: user.password });
  45  |     await page.goto(editorUrl);
  46  |     await expect(page.getByRole("button", { name: /^chat$/i })).toBeVisible();
  47  |     await expect(page.getByRole("button", { name: /^ai review$/i })).toBeVisible();
  48  |     await expect(page.getByRole("button", { name: /^versions$/i })).toBeVisible();
  49  |   });
  50  | 
  51  |   test("switching to AI Review tab shows the review panel", async ({ page }) => {
  52  |     await login(page, { email: user.email, password: user.password });
  53  |     await page.goto(editorUrl);
> 54  |     await page.getByRole("button", { name: /^ai review$/i }).click();
      |                                                              ^ TimeoutError: locator.click: Timeout 15000ms exceeded.
  55  |     // Use role selector to avoid strict-mode violation (button vs placeholder text)
  56  |     await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible({ timeout: 10000 });
  57  |   });
  58  | 
  59  |   test("switching to Versions tab shows the versions panel", async ({ page }) => {
  60  |     await login(page, { email: user.email, password: user.password });
  61  |     await page.goto(editorUrl);
  62  |     await page.getByRole("button", { name: /^versions$/i }).click();
  63  |     // The VersionHistory component shows "Version History" heading and a "Save" button
  64  |     await expect(page.getByText(/version history/i)).toBeVisible({ timeout: 5000 });
  65  |     await expect(page.getByRole("button", { name: /^save$/i })).toBeVisible({ timeout: 5000 });
  66  |   });
  67  | 
  68  |   test("language selector is visible in header", async ({ page }) => {
  69  |     await login(page, { email: user.email, password: user.password });
  70  |     await page.goto(editorUrl);
  71  |     const langSelector = page.locator("select, [role='combobox']").first();
  72  |     await expect(langSelector).toBeVisible({ timeout: 10000 });
  73  |   });
  74  | 
  75  |   test("Share button opens share modal", async ({ page }) => {
  76  |     await login(page, { email: user.email, password: user.password });
  77  |     await page.goto(editorUrl);
  78  |     await page.getByRole("button", { name: /share/i }).click();
  79  |     await expect(page.getByText(/copy|share link/i).first()).toBeVisible({ timeout: 5000 });
  80  |   });
  81  | 
  82  |   test("Back button returns to dashboard", async ({ page }) => {
  83  |     await login(page, { email: user.email, password: user.password });
  84  |     await page.goto(editorUrl);
  85  |     await page.getByRole("button", { name: /← back/i }).click();
  86  |     await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  87  |   });
  88  | 
  89  |   test("Make Public / Make Private toggle is visible", async ({ page }) => {
  90  |     await login(page, { email: user.email, password: user.password });
  91  |     await page.goto(editorUrl);
  92  |     const toggleBtn = page.getByRole("button", { name: /make (public|private)/i });
  93  |     await expect(toggleBtn).toBeVisible({ timeout: 10000 });
  94  |   });
  95  | 
  96  |   test("visibility toggle changes button label", async ({ page }) => {
  97  |     await login(page, { email: user.email, password: user.password });
  98  |     await page.goto(editorUrl);
  99  | 
  100 |     const toggleBtn = page.getByRole("button", { name: /make (public|private)/i });
  101 |     const initialText = await toggleBtn.innerText();
  102 |     await toggleBtn.click();
  103 | 
  104 |     await expect(page.getByRole("button", {
  105 |       name: initialText.includes("Public") ? /make private/i : /make public/i
  106 |     })).toBeVisible({ timeout: 10000 });
  107 |   });
  108 | });
  109 | 
```