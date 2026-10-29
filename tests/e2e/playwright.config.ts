import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration (Spec §15.1).
 * 
 * Tests API integration scenarios end-to-end. When the web frontend is built,
 * browser tests will use the `page` fixture against `apps/web`.
 *
 * Spec §15.1: "browser E2E for role flows"
 * Spec §14: "API target p95 <500ms excluding long jobs"
 */
export default defineConfig({
  testDir: "./specs",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // Financial tests must be sequential
  retries: 0, // No retries — financial tests must be deterministic
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:4000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },

  projects: [
    {
      name: "api",
      testMatch: /.*\.api\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "browser",
      testMatch: /.*\.browser\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.E2E_WEB_URL || "http://localhost:3000",
      },
    },
  ],

  webServer: [
    {
      command: "cd ../.. && npx tsx apps/api/src/index.ts",
      port: 4000,
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});