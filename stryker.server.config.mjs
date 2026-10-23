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
    "apps/collab-server/src/licence.test.ts",
    "apps/collab-server/src/licence.property.test.ts",
    "apps/collab-server/src/limits.test.ts",
    "apps/collab-server/src/limits.property.test.ts",
    "apps/collab-server/src/config.test.ts",
  ],

  mutate: [
    "apps/collab-server/src/licence.ts",
    "apps/collab-server/src/limits.ts",
    "apps/collab-server/src/config.ts",
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
