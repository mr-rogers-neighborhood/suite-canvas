import { defineConfig, devices } from "@playwright/test";

// A trace for every test costs about 0.1-1.3 MB per test (measured: 100 KB for
// the boot test, 1.3 MB for a two-client collab test), so 132 tests is roughly
// 15-170 MB per run. Keep that opt-in and retain traces for failures only.
const trace: "on" | "retain-on-failure" =
  process.env.SUITE_TRACE === "on" ? "on" : "retain-on-failure";

// UI mode (`--ui`, or `--ui-host`/`--ui-port`, which imply it) runs the same
// webServer entries as `pnpm e2e`. It is an interactive, single-operator window
// and never a CI gate, so it always reuses whatever is already listening on
// :5173 and :1235: a second Vite or relay on those fixed ports can only fail
// with EADDRINUSE and take the window down. `reuseExistingServer` only decides
// what happens when the URL is *already* up — with nothing running, UI mode
// still starts the servers itself.
const uiMode = process.argv.some((arg) => /^--ui(-host|-port)?(=|$)/.test(arg));
const reuseExistingServer = uiMode || !process.env.CI;

export default defineConfig({
  testDir: "./tests",
  // Playwright's default, spelled out so `pnpm e2e:trace` can rely on it.
  outputDir: "./test-results",
  fullyParallel: true,
  // A canvas test is a real browser plus a websocket plus a seeded document, and
  // the suite has grown past 150 tests: at full parallelism two runs produced a
  // different 30 s timeout each time (a collab drag, a context menu) while every
  // test passed in isolation. Capping workers and allowing a slower default
  // trades a little wall-clock for a deterministic gate.
  workers: process.env.CI ? 3 : "50%",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace,
    video: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @suite/canvas dev",
      url: "http://localhost:5173",
      reuseExistingServer,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @suite/collab-server start",
      // Loro's sync endpoint is a WebSocket, so probe a small HTTP health
      // endpoint on the adjacent port instead.
      url: "http://localhost:1235/health",
      reuseExistingServer,
      timeout: 30_000,
      env: {
        // The suite creates hundreds of workspaces from one address.
        SUITE_CLAIM_RATE_LIMIT: "10000",
        SUITE_ROTATE_RATE_LIMIT: "10000",
        SUITE_SHARE_RESOLVE_RATE_LIMIT: "10000",
        SUITE_SHARE_CREATE_RATE_LIMIT: "10000",
        SUITE_PUBLISH_RATE_LIMIT: "10000",
        // The suite creates a workspace and often a share per test; without a
        // sweep the dev instance accumulates hundreds of projection rooms and
        // slows every later run. One idle hour is enough for a test run.
        SUITE_ROOM_IDLE_HOURS: "1",
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
