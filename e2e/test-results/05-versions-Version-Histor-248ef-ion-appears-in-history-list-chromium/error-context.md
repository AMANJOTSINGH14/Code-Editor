# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 05-versions.spec.js >> Version History >> saved version appears in history list
- Location: tests\05-versions.spec.js:72:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Listed Version 1779847601775')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByText('Listed Version 1779847601775')

```

```yaml
- banner:
  - button "← Back"
  - text: Version Doc 1779847601775 Room 6a1651b4d0c11261e36c18cc
  - combobox:
    - option "javascript" [selected]
    - option "typescript"
    - option "python"
    - option "java"
    - option "go"
    - option "rust"
    - option "csharp"
  - text: VT 1 online
  - button "Contrib 1"
  - button "Make Private"
  - button "Share"
  - text: ● Live
- code:
  - textbox "Editor content"
- button "Chat"
- button "AI Review"
- button "Versions"
- heading "Version History" [level=3]
- textbox "Version label (optional)": Listed Version 1779847601775
- button "Save"
- text: Rate limit exceeded No versions yet. Save your first version above.
- alert
- alert
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
  11  | test.describe("Version History", () => {
  12  |   test.beforeAll(async ({ browser }) => {
  13  |     const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  14  |     const page = await context.newPage();
  15  |     user = await registerAndLogin(page, {
  16  |       name: "Version Tester",
  17  |       email: `versions_${UNIQUE}@e2e.test`,
  18  |       password: "Password123!"
  19  |     });
  20  |     const result = await createDocument(page, { title: `Version Doc ${UNIQUE}` });
  21  |     editorUrl = `/editor/${result.docId}`;
  22  |     // Type some code so snapshots aren't empty
  23  |     await page.waitForSelector(".monaco-editor", { timeout: 25000 });
  24  |     await page.locator(".monaco-editor .view-lines").first().click();
  25  |     await page.keyboard.type("const hello = 'world';");
  26  |     await page.waitForTimeout(1000);
  27  |     await context.close();
  28  |   });
  29  | 
  30  |   test("Versions tab is present and shows Version History heading", async ({ page }) => {
  31  |     await login(page, { email: user.email, password: user.password });
  32  |     await page.goto(editorUrl);
  33  |     await page.getByRole("button", { name: /^versions$/i }).click();
  34  |     await expect(page.getByText(/version history/i)).toBeVisible({ timeout: 5000 });
  35  |     await expect(page.getByRole("button", { name: /^save$/i })).toBeVisible({ timeout: 5000 });
  36  |   });
  37  | 
  38  |   test("shows empty state for a fresh document with no versions", async ({ page }) => {
  39  |     // Create a brand-new doc in this test to guarantee zero versions
  40  |     await login(page, { email: user.email, password: user.password });
  41  |     const { docId } = await createDocument(page, { title: `Empty Versions ${UNIQUE}` });
  42  |     await page.goto(`/editor/${docId}`);
  43  |     await page.getByRole("button", { name: /^versions$/i }).click();
  44  |     // "No versions yet. Save your first version above."
  45  |     await expect(page.getByText(/no versions yet/i)).toBeVisible({ timeout: 10000 });
  46  |   });
  47  | 
  48  |   test("version label input has correct placeholder", async ({ page }) => {
  49  |     await login(page, { email: user.email, password: user.password });
  50  |     await page.goto(editorUrl);
  51  |     await page.getByRole("button", { name: /^versions$/i }).click();
  52  |     await expect(page.getByPlaceholder(/version label/i)).toBeVisible({ timeout: 5000 });
  53  |   });
  54  | 
  55  |   test("can save a version with a label", async ({ page }) => {
  56  |     await login(page, { email: user.email, password: user.password });
  57  |     await page.goto(editorUrl);
  58  |     await page.getByRole("button", { name: /^versions$/i }).click();
  59  | 
  60  |     await page.getByPlaceholder(/version label/i).fill(`v1.0 Release ${UNIQUE}`);
  61  |     await page.getByRole("button", { name: /^save$/i }).click();
  62  | 
  63  |     // Either the cooldown timer ("10s") OR the label appear — both are valid success signals.
  64  |     // Use .first() to avoid strict-mode violation when both are in DOM simultaneously.
  65  |     await expect(
  66  |       page.locator("button").filter({ hasText: /^\d+s$/ })
  67  |         .or(page.getByText(`v1.0 Release ${UNIQUE}`))
  68  |         .first()
  69  |     ).toBeVisible({ timeout: 15000 });
  70  |   });
  71  | 
  72  |   test("saved version appears in history list", async ({ page }) => {
  73  |     await login(page, { email: user.email, password: user.password });
  74  |     await page.goto(editorUrl);
  75  |     await page.getByRole("button", { name: /^versions$/i }).click();
  76  | 
  77  |     const label = `Listed Version ${UNIQUE}`;
  78  |     await page.getByPlaceholder(/version label/i).fill(label);
  79  |     await page.getByRole("button", { name: /^save$/i }).click();
  80  | 
  81  |     // Version label div appears in the list
> 82  |     await expect(page.getByText(label)).toBeVisible({ timeout: 15000 });
      |                                         ^ Error: expect(locator).toBeVisible() failed
  83  |   });
  84  | 
  85  |   test("saved version has Preview and Restore buttons", async ({ page }) => {
  86  |     await login(page, { email: user.email, password: user.password });
  87  |     await page.goto(editorUrl);
  88  |     await page.getByRole("button", { name: /^versions$/i }).click();
  89  | 
  90  |     const label = `Preview Version ${UNIQUE}`;
  91  |     await page.getByPlaceholder(/version label/i).fill(label);
  92  |     await page.getByRole("button", { name: /^save$/i }).click();
  93  | 
  94  |     // Wait for the version to appear in the list
  95  |     await expect(page.getByText(label)).toBeVisible({ timeout: 15000 });
  96  | 
  97  |     // Preview and Restore buttons are in the version card
  98  |     await expect(page.getByRole("button", { name: /^preview$/i }).first()).toBeVisible({ timeout: 5000 });
  99  |     await expect(page.getByRole("button", { name: /^restore$/i }).first()).toBeVisible({ timeout: 5000 });
  100 |   });
  101 | });
  102 | 
```