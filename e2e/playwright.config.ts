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

/**
 * The canvas is ICE, and ICE needs a real WebGPU adapter. Playwright's bundled
 * headless Chromium has none, so the specs that read what the canvas draws skip
 * unless `SUITE_ICE_E2E=1` (`./tests/support.ts` owns that gate). The same
 * switch turns the one project into the harness those specs need: system
 * Chrome, headed, with the WebGPU flags `./tests/ice.spec.ts` already uses. One
 * knob, so "the ICE specs ran" and "the desk could start" can never disagree.
 *
 * Headless is not an option for the desk (measured: every headless mode reports
 * SwiftShader and loses the device within ~6s), so `scripts/with-display.mjs`
 * runs the whole suite on a virtual X display instead: Chrome is headed, picks
 * up the hardware adapter, and no window ever appears on the user's screen.
 * `SUITE_ICE_VISIBLE=1` opts back into the real display for debugging.
 */
const iceHarness = process.env.SUITE_ICE_E2E === "1";

/**
 * The WebGPU launch options, shared with `./tests/ice.spec.ts` (which launches
 * its own browser) — one list, so the gate and the spec cannot drift.
 */
export const ICE_LAUNCH_OPTIONS = {
  channel: "chrome",
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=vulkan",
    "--enable-unsafe-swiftshader",
    "--ozone-platform=x11",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
  ],
} as const;

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
  //
  // A fixed number, not "50%": on a 16-core box that meant 8 browsers, and the
  // two-browser presence specs (an ephemeral-store round trip plus a React Flow
  // re-render on both sides) lost that race — different test, same shape, every
  // run. Four is measured: 159/159 twice at 4, and flaking at 6 and 8. The
  // ceiling is per browser, not per core, so it does not scale with the machine.
  workers: process.env.CI ? 3 : 4,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // `html --open=never` writes `e2e/playwright-report/`: the run never steals
  // focus while it is going, and the screenshots, traces and timings are there
  // afterwards for whoever wants to look. `list` stays for the live progress.
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
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
  projects: [
    // Behaviour. Every spec here drives the app; under the virtual display they
    // all share the harness's Chrome, so the desk specs and the shell specs see
    // the same browser.
    {
      name: "chromium",
      testIgnore: /visual\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...(iceHarness
          ? {
              channel: ICE_LAUNCH_OPTIONS.channel,
              headless: ICE_LAUNCH_OPTIONS.headless,
              launchOptions: { args: [...ICE_LAUNCH_OPTIONS.args] },
            }
          : {}),
      },
    },
    // Appearance. Screenshot baselines are committed art: they were recorded in
    // headless Chromium, and a headed browser (which the desk needs) antialiases
    // and hints text slightly differently, so these always run headless — the
    // only machine-independent renderer the project has.
    {
      name: "visual",
      testMatch: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], headless: true },
    },
  ],
});
