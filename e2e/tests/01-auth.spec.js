// @ts-check
const { test, expect } = require("@playwright/test");

// Force a completely fresh browser context for every test in this file
// so localStorage / cookies never bleed across tests.
test.use({ storageState: { cookies: [], origins: [] } });

const UNIQUE = Date.now();
const USER = {
  name: "Auth Tester",
  email: `auth_${UNIQUE}@e2e.test`,
  password: "Password123!"
};

test.describe("Authentication", () => {
  test("redirects unauthenticated users to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("register page loads", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();
  });

  test("register with valid credentials → lands on dashboard", async ({ page }) => {
    await page.goto("/register");
    await page.getByPlaceholder("Name").fill(USER.name);
    await page.getByPlaceholder("Email").fill(USER.email);
    await page.getByPlaceholder(/password/i).fill(USER.password);
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
    await expect(page.getByText(/hello/i)).toBeVisible();
  });

  test("register shows error for duplicate email", async ({ page }) => {
    // USER was registered in the previous test (DB is shared)
    await page.goto("/register");
    await page.getByPlaceholder("Name").fill(USER.name);
    await page.getByPlaceholder("Email").fill(USER.email);
    await page.getByPlaceholder(/password/i).fill(USER.password);
    await page.getByRole("button", { name: /create account/i }).click();

    // Error div appears with class text-rose-400
    await expect(page.locator(".text-rose-400")).toBeVisible({ timeout: 10000 });
  });

  test("register shows error for short password", async ({ page }) => {
    await page.goto("/register");
    await page.getByPlaceholder("Name").fill("Test");
    await page.getByPlaceholder("Email").fill(`short_${UNIQUE}@e2e.test`);
    await page.getByPlaceholder(/password/i).fill("short");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.locator(".text-rose-400")).toBeVisible({ timeout: 5000 });
  });

  test("login with valid credentials → dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(USER.email);
    await page.getByPlaceholder("Password").fill(USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  });

  test("login with wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(USER.email);
    await page.getByPlaceholder("Password").fill("WrongPassword999!");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for error to appear – works because context is fresh (no stored token)
    await expect(page.locator(".text-rose-400")).toBeVisible({ timeout: 12000 });
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test("logout clears session and redirects to /login", async ({ page }) => {
    // Log in first
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(USER.email);
    await page.getByPlaceholder("Password").fill(USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Click logout
    await page.getByRole("button", { name: /log out/i }).click();

    // Must land on /login (PrivateRoute clears token → redirects)
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test("authenticated user visiting /login is redirected to /dashboard", async ({ page }) => {
    // Log in
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(USER.email);
    await page.getByPlaceholder("Password").fill(USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Navigate to /login while authenticated → should redirect back
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });
});
