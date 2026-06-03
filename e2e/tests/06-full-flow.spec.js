// @ts-check
const { test, expect } = require("@playwright/test");

test.use({ storageState: { cookies: [], origins: [] } });

const UNIQUE = Date.now();

test("Complete user journey: register → create doc → code → AI review → versions → logout", async ({ page }) => {
  // ── 1. Register ──
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();
  await page.getByPlaceholder("Name").fill("Full Flow User");
  await page.getByPlaceholder("Email").fill(`fullflow_${UNIQUE}@e2e.test`);
  await page.getByPlaceholder(/password/i).fill("Password123!");
  await page.getByRole("button", { name: /create account/i }).click();

  // ── 2. Dashboard ──
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
  await expect(page.getByText(/hello/i)).toBeVisible();

  // ── 3. Create Document ──
  const docTitle = `Full Flow Doc ${UNIQUE}`;
  await page.getByPlaceholder("Document title").fill(docTitle);
  await page.getByRole("combobox").selectOption("javascript");
  await page.getByRole("button", { name: /create document/i }).click();

  // ── 4. Editor loads ──
  await expect(page).toHaveURL(/\/editor\//, { timeout: 20000 });
  await expect(page.getByText(docTitle)).toBeVisible();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 25000 });

  // ── 5. Connection badge visible ──
  await expect(page.locator("text=/Live|Offline/")).toBeVisible({ timeout: 10000 });

  // ── 6. Type some code in Monaco ──
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.type("function greet(name) {\n  return 'Hello, ' + name;\n}\nconsole.log(greet('World'));");
  await page.waitForTimeout(1500); // allow CRDT sync

  // ── 7. Switch to AI Review tab ──
  await page.getByRole("button", { name: /^ai review$/i }).click();
  await expect(page.getByRole("button", { name: /review my code/i })).toBeVisible({ timeout: 5000 });

  // ── 8. Trigger AI Review (uses mock Gemini) ──
  await page.getByRole("button", { name: /review my code/i }).click();
  // Loading state
  await expect(page.getByRole("button", { name: /reviewing\.\.\./i })).toBeVisible({ timeout: 10000 });
  // Mock review output
  await expect(page.getByText(/mock ai review|mock review|strengths|issues/i))
    .toBeVisible({ timeout: 30000 });

  // ── 9. Switch to Versions tab ──
  await page.getByRole("button", { name: /^versions$/i }).click();
  await expect(page.getByText(/version history/i)).toBeVisible({ timeout: 5000 });

  // Save a version
  await page.getByPlaceholder(/version label/i).fill("v1.0 - Initial commit");
  await page.getByRole("button", { name: /^save$/i }).click();
  // Cooldown timer or label appears — use .first() to avoid strict-mode violation
  await expect(
    page.locator("button").filter({ hasText: /^\d+s$/ })
      .or(page.getByText("v1.0 - Initial commit"))
      .first()
  ).toBeVisible({ timeout: 15000 });

  // ── 10. Visibility toggle ──
  const toggleBtn = page.getByRole("button", { name: /make (public|private)/i });
  await expect(toggleBtn).toBeVisible({ timeout: 5000 });
  await toggleBtn.click();
  // Toast notification
  await expect(page.getByText(/room is now/i)).toBeVisible({ timeout: 10000 });

  // ── 11. Go back to dashboard ──
  await page.getByRole("button", { name: /← back/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(docTitle)).toBeVisible({ timeout: 10000 });

  // ── 12. Logout ──
  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

  // ── 13. Verify session cleared ──
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("Health endpoint returns ok", async ({ request }) => {
  const response = await request.get("http://localhost:3001/health");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.data.status).toBe("ok");
  expect(body.data.mongo).toBe("connected");
});
