import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Restart the shell when the main process or the preload changes.
 *
 * A restart, not a hot swap. The main process owns the document, the lock and the
 * backup timer; replacing those underneath a running window would be a story
 * about state that is not true. A restart reopens the file, which is also what a
 * user does after a crash, so the loop exercises the recovery path every time.
 *
 * The renderer is not watched here: Vite already does that, and reloading the
 * page for a main-process change would hide which half moved.
 */

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const out = join(app, "dist");

mkdirSync(join(out, "preload"), { recursive: true });

function stagePreload() {
  copyFileSync(join(app, "src", "preload", "index.cjs"), join(out, "preload", "index.cjs"));
}

const children = [];
function stopAll() {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}
process.on("exit", stopAll);

const tsc = spawn("pnpm", ["exec", "tsc", "-w", "-p", "tsconfig.build.json"], {
  cwd: app,
  stdio: "inherit",
});
children.push(tsc);

// The preload is CommonJS, so `tsc` does not compile it. Copy it on change, the
// same way the one-shot build does.
watch(join(app, "src", "preload"), () => {
  try {
    stagePreload();
    schedule("preload");
  } catch (error) {
    console.error("could not stage the preload:", error);
  }
});

let timer = null;
let pending = null;
function schedule(reason) {
  pending = reason;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    restart(pending);
  }, 350);
}

let electron = null;
function restart(reason) {
  if (electron !== null) {
    electron.kill("SIGTERM");
    electron = null;
  }
  console.log(`\n[desktop] restarting (${reason})`);
  electron = spawn(process.execPath, [join(here, "shell.mjs")], {
    cwd: app,
    stdio: "inherit",
  });
  children.push(electron);
  electron.on("exit", (code) => {
    // A window the user closed ends the loop; a crash is reported by the shell.
    if (code === 0) stopAll();
  });
}

// `tsc -w` prints "Found N errors" and keeps running, so the build is done when
// the last emit settles rather than when the process exits.
watch(out, { recursive: true }, (_event, file) => {
  if (file === null) return;
  if (file.startsWith("preload")) return;
  if (!file.endsWith(".js")) return;
  schedule(file);
});

stagePreload();
restart("first build");
