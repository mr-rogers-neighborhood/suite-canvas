import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Start the desktop shell against a renderer.
 *
 * Two ways to find that renderer, and the difference matters:
 *
 * - **the dev server** (`SUITE_DESKTOP_DEV_URL`) when a Vite server is already
 *   running. Edits appear in the window, which is the whole point of the loop.
 * - **the built bundle** (`apps/canvas/dist`) otherwise. That is what the packaged
 *   app ships, so a question about packaging is answerable here too.
 *
 * Electron is resolved from this package's own `package.json` rather than a path
 * relative to it: pnpm keeps a workspace package's dependencies in its own
 * `node_modules`, and a hardcoded `../../node_modules` is a path that only works
 * on some machines. That mistake is what made `pnpm dev` fail.
 */

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const canvasDist = join(app, "..", "canvas", "dist");

const devUrl = process.env.SUITE_DESKTOP_DEV_URL?.trim() || null;

if (devUrl === null && !existsSync(join(canvasDist, "index.html"))) {
  console.error(
    [
      "apps/canvas/dist is missing, and no dev server URL was given.",
      "",
      "For the development loop:",
      "  pnpm dev:desktop",
      "",
      "To run the built bundle once:",
      "  pnpm --filter @suite/desktop build",
      "  pnpm --filter @suite/desktop dev:shell",
    ].join("\n"),
  );
  process.exit(1);
}

const electron = createRequire(join(app, "package.json")).resolve("electron/cli.js");

const child = spawn(process.execPath, [electron, app, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    SUITE_SHELL_VERSION: "0.1.0-dev",
    ...(devUrl === null ? {} : { SUITE_DESKTOP_DEV_URL: devUrl }),
  },
});

// A window that closes ends this process; a signal stops the window.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
// Preserve *how* the window ended. A child killed by a signal gives `code ===
// null`, and reporting that as a clean 0 told the watcher the user had closed the
// window, so a restart terminated the loop instead of replacing the process.
child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
