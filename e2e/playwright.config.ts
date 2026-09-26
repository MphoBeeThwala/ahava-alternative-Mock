import { defineConfig, devices } from "@playwright/test";

// Run through e2e/run.mjs (`pnpm test:e2e`), which starts the database, API
// and frontend and sets E2E_BASE_URL / E2E_API_URL.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results/artifacts",
  // One flow shares state (the patient's case is what the doctor reviews);
  // run serially against one real database.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "./test-results/report" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
      },
    },
    {
      // Most patients will be on a phone.
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
      },
    },
  ],
});
