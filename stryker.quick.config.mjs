/**
 * Fast iteration: one file, its own report and incremental state so a quick
 * run never overwrites (or poisons) the full graph report.
 *
 * `pnpm mutation:quick` mutates search.ts. To try another file, pass
 * `--mutate <file>` — the rest of the scoping stays identical to the full run.
 */
import graph from "./stryker.graph.config.mjs";

export default {
  ...graph,
  mutate: ["packages/graph/src/search.ts"],
  incrementalFile: "reports/stryker-incremental-quick.json",
  htmlReporter: { fileName: "reports/mutation/quick.html" },
  jsonReporter: { fileName: "reports/mutation/quick.json" },
};
