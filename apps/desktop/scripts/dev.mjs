import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Run the desktop shell against the canvas build beside it.
 *
 * Development only: it expects `apps/canvas/dist` to exist, so a canvas build is
 * the prerequisite. Any argument is passed through, which is how a file gets
 * opened on a cold start.
 */
const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, "..");
const renderer = join(app, "..", "canvas", "dist");

if (!existsSync(join(renderer, "index.html"))) {
  console.error("apps/canvas/dist is missing. Run `pnpm --filter @suite/canvas build` first.");
  process.exit(1);
}

const electron = join(app, "..", "..", "node_modules", "electron", "cli.js");
const child = spawn(process.execPath, [electron, app, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, SUITE_SHELL_VERSION: "0.1.0-dev" },
});
child.on("exit", (code) => process.exit(code ?? 0));
