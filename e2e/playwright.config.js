// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15000,
    navigationTimeout: 30000,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure"
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],

  // Auto-start both servers before tests
  webServer: [
    {
      command: "set GEMINI_MOCK=true && set REDIS_URL= && node src/server.js",
      cwd: "../server",
      url: "http://localhost:3001/health",
      reuseExistingServer: true,
      timeout: 30000,
      env: {
        NODE_ENV: "development",
        PORT: "3001",
        GEMINI_MOCK: "true",
        REDIS_URL: "",
        CHROMA_URL: "http://localhost:8000"
      }
    },
    {
      command: "npm run dev -- --port 3000",
      cwd: "../client",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 30000
    }
  ]
});
