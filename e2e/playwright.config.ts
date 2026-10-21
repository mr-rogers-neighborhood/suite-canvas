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
      // Loro's sync endpoint is a WebSocket, so probe a small HTTP health
      // endpoint on the adjacent port instead.
      url: "http://localhost:1235/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
