import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @suite/canvas dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @suite/collab-server start",
      // Probing the port lets Playwright reuse a dev server you already have
      // running instead of spawning one that cannot bind.
      url: "http://localhost:1234",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
