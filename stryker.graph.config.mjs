/**
 * Mutation testing for `@suite/graph` — the only package where a full run is
 * affordable: the whole graph suite runs in seconds, so reward per mutant is
 * high and per-test coverage narrows each mutant to a handful of tests.
 *
 * Why `.mjs` and not JSON: every option below needs a reason next to it, and
 * JSON cannot carry comments. The two targets (graph, server) also need
 * different `vitest`/`testFiles` scoping, which is honest as two files rather
 * than one config with impossible conditionals.
 *
 * Report-only on purpose: no `thresholds.break`. A mutation score is a
 * diagnostic for deciding where to write tests, not a number to satisfy.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// pnpm links the runner under `.pnpm/`, and Stryker's `@stryker-mutator/*`
// auto-discovery resolves relative to core's *real* path, where only core is
// visible. Resolving from this config is the only reliable way to load it.
const vitestRunner = fileURLToPath(import.meta.resolve("@stryker-mutator/vitest-runner"));

export default {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",

  plugins: [vitestRunner],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.ts",
    // `testFiles` below already pins the suite to the graph project; `related`
    // would additionally drop tests that reach a module through the `index.ts`
    // barrel, which would silently weaken the score. perTest coverage still
    // narrows each mutant to the tests that actually execute it.
    related: false,
  },
  // Without this, vitest would discover the server and canvas projects too.
  testFiles: ["packages/graph/src/**/*.test.ts"],

  mutate: [
    // Publish planning and apply live under `publish/`; `merge.ts` is now only
    // a re-export barrel, so mutating it would score an empty file.
    "packages/graph/src/publish/*.ts",
    "packages/graph/src/projection.ts",
    "packages/graph/src/search.ts",
    "packages/graph/src/views.ts",
    "packages/graph/src/sections.ts",
  ],

  // Never copied into the sandbox: build output, coverage and Playwright
  // artifacts are large and are being rewritten by other processes.
  ignorePatterns: [
    "coverage/**",
    "reports/**",
    "e2e/test-results/**",
    "e2e/playwright-report/**",
    "**/dist/**",
    "**/storybook-static/**",
  ],

  reporters: ["html", "json", "clear-text"],
  htmlReporter: { fileName: "reports/mutation/graph.html" },
  jsonReporter: { fileName: "reports/mutation/graph.json" },

  // Incremental state is per-machine: mutant ids include the sandbox layout and
  // timings depend on what else is running. It is gitignored (see .gitignore)
  // so a stale file cannot make CI or a teammate trust a score it did not earn.
  incremental: true,
  incrementalFile: "reports/stryker-incremental-graph.json",

  // Half the cores: other work (and other agents) share this machine.
  concurrency: "50%",
  // A hanging mutant fails after max(10 s, 1.5 × its normal runtime) instead of
  // stalling the whole run; 10 s is already enormous next to a 2 s suite.
  timeoutMS: 10_000,
  timeoutFactor: 1.5,
  // Static mutants force a full module reload plus the whole suite each time.
  // They are mostly import-time constants and produce little signal here.
  ignoreStatic: true,

  // No `thresholds.break`: report-only.
  thresholds: { high: 80, low: 60, break: null },
};

// The patch below is invisible when it is missing: Stryker still runs, every
// mutant is reported Survived, and the report looks like a terrible test suite
// rather than a broken runner. So fail here, at config load, with the reason.
const joinerFix = "join(' > ')";
const runnerFiles = ["stryker-setup.js", "test-helpers.js"].map(
  (name) => `node_modules/@stryker-mutator/vitest-runner/dist/src/${name}`,
);
for (const file of runnerFiles) {
  let source;
  try {
    source = readFileSync(new URL(file, import.meta.url), "utf8");
  } catch {
    throw new Error(
      `${file} is not installed. Run pnpm install before pnpm mutation; the runner patch lives in patches/.`,
    );
  }
  if (!source.includes(joinerFix)) {
    throw new Error(
      `${file} does not contain ${joinerFix}. patches/@stryker-mutator__vitest-runner@10.0.0.patch was not applied, ` +
        "so every mutant would be reported Survived. Check `patchedDependencies` in pnpm-workspace.yaml and re-run pnpm install.",
    );
  }
}
