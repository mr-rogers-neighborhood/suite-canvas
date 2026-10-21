import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
          name: "canvas",
          environment: "jsdom",
          include: ["apps/canvas/src/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/canvas/src/test/setup.ts"],
        },
      },
    ],
  },
});
