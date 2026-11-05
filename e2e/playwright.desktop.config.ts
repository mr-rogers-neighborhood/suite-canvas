import { defineConfig } from "@playwright/test";

/**
 * The desktop tier.
 *
 * It is a separate config rather than a project inside `playwright.config.ts`
 * because it needs none of that harness: no Vite server, no relay, no Postgres,
 * no hosted origin. Starting four servers to launch one application would make
 * the tier slow enough to skip, which is how a gate stops being run.
 *
 * A display is required. On a headless machine wrap the command in `xvfb-run`;
 * `docs/how-to/test-and-verify.md` says so next to the script name.
 *
 * Serial, because each spec owns a lock and a library directory, and a lock that
 * two tests contend for is the feature under test rather than a flake to route
 * around.
 */
export default defineConfig({
  testDir: "./tests/desktop",
  outputDir: "./test-results/desktop",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
