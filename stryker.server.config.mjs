/**
 * Mutation testing for the pure parts of `@suite/collab-server`.
 *
 * The server project also holds socket and SQLite suites that take minutes;
 * Stryker re-runs the covering tests for every mutant, so `testFiles` pins the
 * run to the unit and property tests of the three modules being mutated. Any
 * mutant that those files do not cover is reported as survived/not covered on
 * purpose — that is a signal that the module's own tests are thin, not a reason
 * to drag the integration suites in.
 *
 * `.mjs` for the same reason as the graph config: comments that explain the
 * scoping, and report-only thresholds (no `thresholds.break`).
 */
import { fileURLToPath } from "node:url";

// See stryker.graph.config.mjs — pnpm's layout hides the runner from the
// plugin auto-discovery glob.
const vitestRunner = fileURLToPath(import.meta.resolve("@stryker-mutator/vitest-runner"));

export default {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",

  plugins: [vitestRunner],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.ts",
    related: false,
  },
  testFiles: [
    "packages/licence/src/token.test.ts",
    "packages/licence/src/property.test.ts",
    "apps/collab-server/src/config/limits.test.ts",
    "apps/collab-server/src/config/limits.property.test.ts",
    "apps/collab-server/src/config/config.test.ts",
  ],

  mutate: [
    // The licence token is a package now (`@suite/licence`), shared with the
    // billing service; it stays in this run because this is the config whose
    // tests already cover it.
    "packages/licence/src/base64Url.ts",
    "packages/licence/src/claims.ts",
    "packages/licence/src/environment.ts",
    "packages/licence/src/keys.ts",
    "packages/licence/src/messages.ts",
    "packages/licence/src/quota.ts",
    "packages/licence/src/sign.ts",
    "packages/licence/src/verify.ts",
    "apps/collab-server/src/config/limits.ts",
    "apps/collab-server/src/config/config.ts",
  ],

  // Never copied into the sandbox: build output, coverage and Playwright
  // artifacts are large and can be rewritten while a run is in flight.
  ignorePatterns: [
    "coverage/**",
    "reports/**",
    "e2e/test-results/**",
    "e2e/playwright-report/**",
    "**/dist/**",
    "**/storybook-static/**",
  ],

  reporters: ["html", "json", "clear-text"],
  htmlReporter: { fileName: "reports/mutation/server.html" },
  jsonReporter: { fileName: "reports/mutation/server.json" },

  incremental: true,
  incrementalFile: "reports/stryker-incremental-server.json",

  concurrency: "50%",
  timeoutMS: 10_000,
  timeoutFactor: 1.5,
  ignoreStatic: true,

  // No `thresholds.break`: report-only.
  thresholds: { high: 80, low: 60, break: null },
};
