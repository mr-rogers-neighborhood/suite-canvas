import { defineConfig } from "vitest/config";

/**
 * Coverage is collected across all projects in one run, so the reporter options
 * below live at the root. `coverage.thresholds` accepts path globs, which is how
 * the gate is scoped to `@suite/graph` only — `server` and `canvas` are measured
 * and printed but not gated until they have enough real assertions to justify it.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/graph/src/**", "apps/collab-server/src/**", "apps/canvas/src/**"],
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
