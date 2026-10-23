import { defineConfig } from "vitest/config";

/**
 * Coverage is collected across all projects in one run, so the reporter options
 * below live at the root. `coverage.thresholds` accepts path globs, which is how
 * the gate is scoped to `@suite/graph` only — `server` and `canvas` are measured
 * and printed but not gated until they have enough real assertions to justify it.
 */
export default defineConfig({
  test: {
    // CRDT convergence tests move whole documents between peers and run in
    // parallel with the canvas project; the 5 s default produced a load-induced
    // timeout (9.7 s, passed on rerun). 15 s still fails a genuine hang.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "packages/graph/src/**",
        "packages/scene/src/**",
        "apps/collab-server/src/**",
        "apps/canvas/src/**",
      ],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.stories.*",
        "**/dist/**",
        // The operator panel is a separate entry point with its own bundle.
        "**/admin/**",
        "apps/canvas/src/test/**",
        "**/*.d.ts",
        "**/*.css",
      ],
      // Only `@suite/graph` is gated: it has a real suite of behavioural tests.
      // `server` and `canvas` are measured and printed but not gated, so nobody
      // is tempted to add assertion-free tests just to clear a number.
      // A glob key (not a per-project block) is what vitest 5 actually honours —
      // per-project `test.coverage` is accepted by the types but ignored at runtime.
      thresholds: {
        "packages/graph/src/**": {
          statements: 85,
          branches: 74,
          functions: 93,
          lines: 90,
        },
      },
    },
    projects: [
      {
        test: {
          name: "graph",
          environment: "node",
          include: ["packages/graph/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "scene",
          environment: "node",
          include: ["packages/scene/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "server",
          environment: "node",
          include: ["apps/collab-server/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "canvas",
          environment: "jsdom",
          include: ["apps/canvas/src/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/canvas/src/test/setup.ts"],
        },
      },
    ],
  },
});
