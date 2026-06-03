/**
 * Shared E2E test helpers.
 */

const TEST_USER = {
  name: "E2E Tester",
  email: `e2e_${Date.now()}@test.com`,
  password: "Password123!"
};

/**
 * Register and log in as a new user.
 * Returns the user credentials used.
 * @param {import("@playwright/test").Page} page
 * @param {{ name?: string, email?: string, password?: string }} [overrides]
 */
async function registerAndLogin(page, overrides = {}) {
  const user = { ...TEST_USER, ...overrides };

  await page.goto("/register");
  await page.getByPlaceholder("Name").fill(user.name);
  await page.getByPlaceholder("Email").fill(user.email);
  await page.getByPlaceholder(/password/i).fill(user.password);
  await page.getByRole("button", { name: /create account/i }).click();

  // Should land on dashboard
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  return user;
}

/**
 * Log in with existing credentials.
 * @param {import("@playwright/test").Page} page
 * @param {{ email: string, password: string }} creds
 */
async function login(page, creds) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(creds.email);
  await page.getByPlaceholder("Password").fill(creds.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
}

/**
 * Create a PRIVATE document via the Dashboard UI and navigate to its editor.
 * NOTE: The UI creates documents as public by default (isPublic: true).
 * To keep test isolation clean and avoid polluting other users' lists,
 * we fill the form and then immediately toggle visibility to private in the editor.
 *
 * Returns the document title and docId from the URL.
 * @param {import("@playwright/test").Page} page
 * @param {{ title?: string, language?: string }} [opts]
 */
async function createDocument(page, opts = {}) {
  const title = opts.title || `Test Doc ${Date.now()}`;

  await page.waitForURL("**/dashboard");
  const titleInput = page.getByPlaceholder("Document title");
  await titleInput.fill(title);

  if (opts.language) {
    await page.getByRole("combobox").selectOption(opts.language);
  }

  await page.getByRole("button", { name: /create document/i }).click();
  await page.waitForURL("**/editor/**", { timeout: 20000 });

  // Make the document PRIVATE immediately so it doesn't pollute other users' lists
  const toggleBtn = page.getByRole("button", { name: /make private/i });
  if (await toggleBtn.count() > 0) {
    await toggleBtn.click();
    // Wait for toast or button flip
    await page.waitForTimeout(1000);
  }

  const url = page.url();
  const docId = url.split("/editor/")[1];
  return { title, docId };
}

module.exports = { TEST_USER, registerAndLogin, login, createDocument };
