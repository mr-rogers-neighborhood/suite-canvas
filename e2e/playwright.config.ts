import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(E2E_DIR, ".data");
mkdirSync(DATA_DIR, { recursive: true });

// A trace for every test costs about 0.1-1.3 MB per test (measured: 100 KB for
// the boot test, 1.3 MB for a two-client collab test), so 132 tests is roughly
// 15-170 MB per run. Keep that opt-in and retain traces for failures only.
const trace: "on" | "retain-on-failure" =
  process.env.SUITE_TRACE === "on" ? "on" : "retain-on-failure";

// UI mode is an interactive, single-operator window and never a CI gate, so it
// reuses whatever is already listening on :5173 and :1235. Every other run owns
// its servers: reusing a process started before a refactor is how the suite
// tests old code and reports a product failure that does not exist.
const uiMode = process.argv.some((arg) => /^--ui(-host|-port)?(=|$)/.test(arg));
const reuseExistingServer = uiMode;

const database = (name: string) => path.join(DATA_DIR, `${name}.sqlite`);

export default defineConfig({
  testDir: "./tests",
  // Playwright's default, spelled out so `pnpm e2e:trace` can rely on it.
  outputDir: "./test-results",
  fullyParallel: true,
  // A canvas test is a real browser plus a websocket plus a seeded document.
  // Three workers keep the two-browser specs from competing with three other
  // browsers on the same relay; four is available with SUITE_WORKERS=4 when a
  // machine and a change can afford it.
  workers: Number(process.env.SUITE_WORKERS ?? 3),
  retries: process.env.CI ? 1 : 0,
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
      command: "node scripts/with-log.mjs canvas pnpm --filter @suite/canvas dev",
      url: "http://localhost:5173",
      reuseExistingServer,
      timeout: 60_000,
    },
    {
      command: "node scripts/with-log.mjs relay pnpm --filter @suite/collab-server start",
      // Loro's sync endpoint is a WebSocket, so probe a small HTTP health
      // endpoint on the adjacent port instead.
      url: "http://localhost:1235/health",
      reuseExistingServer,
      timeout: 30_000,
      env: {
        // A file per run keeps one suite from inheriting workspaces, shares and
        // room rows from the last one.
        SUITE_DB: database("documents"),
        SUITE_SHARES_DB: database("shares"),
        SUITE_WORKSPACES_DB: database("workspaces"),
        SUITE_SETTINGS_DB: database("settings"),
        SUITE_LICENCE_DB: database("licences"),
        SUITE_ATTACHMENTS_DB: database("attachments"),
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
