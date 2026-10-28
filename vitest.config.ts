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
        "packages/licence/src/**",
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
        // The Obsidian importer reads a vault into a document, so its suite
        // needs the graph's real CRDT and nothing else.
        test: {
          name: "importer",
          environment: "node",
          include: ["packages/import-obsidian/src/**/*.test.ts"],
        },
      },
      {
        // The licence token format is shared by the relay and the billing
        // service, so its suite is its own project rather than either one's.
        test: {
          name: "licence",
          environment: "node",
          include: ["packages/licence/src/**/*.test.ts"],
        },
      },
      {
        // The settings registry and its precedence rules, shared by the control
        // plane, the relay and the panel: pure functions, so its own project.
        test: {
          name: "settings",
          environment: "node",
          include: ["packages/settings/src/**/*.test.ts"],
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
        // The control-plane host. Its own project because the tests bind real
        // sockets and because the contract it publishes is what the auth and
        // billing modules are written against.
        test: {
          name: "control-plane",
          environment: "node",
          include: ["apps/control-plane/src/**/*.test.ts"],
        },
      },
      {
        // The account control plane. Its own project because it is the only
        // suite allowed to reach for `better-auth`, and because a failure here
        // should name itself in CI rather than hide inside the relay's suite.
        test: {
          name: "auth",
          environment: "node",
          include: ["services/auth/src/**/*.test.ts"],
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
