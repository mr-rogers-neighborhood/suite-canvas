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

/**
 * Stop a child and everything it started.
 *
 * Electron runs under `shell.mjs`, so signalling the script alone leaves the
 * application running with no watcher attached: the window survives, the next
 * attempt fights it for the single-instance lock, and `:5173` stays held. The
 * children are spawned in their own process group so the subtree can be signalled
 * at once.
 */
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // No group, or it is already gone; fall back to the process itself.
    child.kill("SIGTERM");
  }
}

function stopAll() {
  for (const child of children) stop(child);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}
process.on("exit", stopAll);

// One compile before the window opens, then the watch. Without this the watch's
// first emit lands just after the shell starts and restarts a window the user has
// only just seen.
const firstBuild = spawn("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], {
  cwd: app,
  stdio: "inherit",
});
await new Promise((resolve) => firstBuild.once("exit", resolve));

const tsc = spawn("pnpm", ["exec", "tsc", "-w", "-p", "tsconfig.build.json"], {
  cwd: app,
  stdio: "inherit",
});
children.push(tsc);

// `tsc -w` emits every file on its first pass, and those writes would look like
// edits and restart a window the user has only just seen. The one-shot build
// above already produced current output, so the first pass is ignored.
const settleUntil = Date.now() + 3_000;

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

let current = null;

/**
 * Replace the window.
 *
 * The old process is waited out before the new one starts. Electron's
 * single-instance lock is released as the process dies, so starting the
 * replacement first makes it believe another copy is running and quit at once,
 * which looks to the user like a window that flickers and closes.
 *
 * A generation counter keeps the exit of a process this function replaced from
 * being read as the user closing the window.
 */
let generation = 0;
function restart(reason) {
  const mine = ++generation;
  const previous = current;
  current = null;

  const startNext = () => {
    if (mine !== generation) return;
    console.log(`\n[desktop] restarting (${reason})`);
    const next = spawn(process.execPath, [join(here, "shell.mjs")], {
      cwd: app,
      stdio: "inherit",
      // Its own group, so `stop` can signal Electron along with the script.
      detached: true,
    });
    children.push(next);
    current = next;
    next.on("exit", (code) => {
      if (mine !== generation) return;
      // The user closed the window, or the shell gave up; either ends the loop.
      if (code === 0) stopAll();
    });
  };

  if (previous === null || previous.exitCode !== null || previous.signalCode !== null) {
    startNext();
    return;
  }

  let replaced = false;
  const finish = () => {
    if (replaced) return;
    replaced = true;
    startNext();
  };
  previous.once("exit", finish);
  stop(previous);
  // A process that will not stop must not wedge the loop.
  setTimeout(() => {
    if (!replaced) {
      try {
        process.kill(-previous.pid, "SIGKILL");
      } catch {
        previous.kill("SIGKILL");
      }
      finish();
    }
  }, 4_000).unref?.();
}

// `tsc -w` prints "Found N errors" and keeps running, so the build is done when
// the last emit settles rather than when the process exits.
watch(out, { recursive: true }, (_event, file) => {
  if (file === null) return;
  if (file.startsWith("preload")) return;
  if (!file.endsWith(".js")) return;
  if (Date.now() < settleUntil) return;
  schedule(file);
});

stagePreload();
restart("first build");
