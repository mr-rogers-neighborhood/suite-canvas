import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/graph/bench/**/*.bench.ts"],
    benchmark: {
      include: ["packages/graph/bench/**/*.bench.ts"],
    },
  },
});
