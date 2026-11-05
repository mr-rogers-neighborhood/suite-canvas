import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The desktop development loop: one dev server, one window.
 *
 * `pnpm dev` is unchanged and starts the servers a browser talks to. This starts
 * the renderer in the profile the desktop shell actually runs (`standalone`, so
 * no relay and no account client), waits for it to answer, and then opens the
 * shell on it.
 *
 * The dev server is this script's child, so closing the window stops it. A
 * server left running would hold :5173 and make the next attempt fail with a
 * port error that says nothing about the cause.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const PREFERRED_PORT = Number(process.env.SUITE_DEV_PORT ?? 5173);

/**
 * The first port from `from` upward that nothing is listening on.
 *
 * The port cannot be left to Vite's "in use, trying another one": this script
 * waits for a server and then points the shell at it, and both need the number
 * Vite actually bound. Guessing 5173 while Vite took 5174 opened the *other*
 * process's page, which is how a stale dev server gets mistaken for this one.
 */
async function freePort(from) {
  for (let port = from; port < from + 20; port += 1) {
    const free = await new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error(`no free port between ${from} and ${from + 19}`);
}

const PORT = await freePort(PREFERRED_PORT);
const origin = `http://localhost:${PORT}`;

const children = [];

/**
 * Stop a child and everything it started.
 *
 * `pnpm` sits between this script and the dev server, so killing the child alone
 * leaves the server listening on :5173 with nothing watching it, and the next run
 * fails on a port that looks busy for no reason. The children are spawned in
 * their own process group so the whole subtree can be signalled at once.
 */
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The group is already gone, or the platform has none; fall back to the pid.
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

function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, ...env },
    // Its own process group, so `stop` can signal the tree rather than the top.
    detached: true,
  });
  children.push(child);
  return child;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// Vite is invoked directly rather than through the package script: `pnpm run
// script -- --port` forwards the `--` as an argument, which Vite ignores, and it
// then quietly picks a port of its own while this script waits on the one it
// chose. `--strictPort` makes a race fail loudly instead of silently relocating.
const canvas = start(
  "pnpm",
  ["--filter", "@suite/canvas", "exec", "vite", "--port", String(PORT), "--strictPort"],
  { FORCE_COLOR: "1", VITE_SUITE_MODE: "standalone" },
);

// A dev server that dies before it listens is a real failure; say so instead of
// waiting out the timeout.
let canvasExited = false;
canvas.on("exit", (code) => {
  canvasExited = true;
  if (code !== 0 && code !== null) {
    console.error(`\nThe canvas dev server exited (${code}). Port ${PORT} may already be in use.`);
    process.exit(code);
  }
});

const ready = await waitForServer(`${origin}/index.html`, 60_000);
if (!ready) {
  if (!canvasExited) {
    console.error(`\nThe canvas dev server did not answer on ${origin} within 60s.`);
  }
  stopAll();
  process.exit(1);
}

// Watch by default: a main-process edit restarts the window, which is the loop
// this command exists for. `--no-watch` is for when a restart would interrupt
// something that cannot be repeated.
const watch = !process.argv.includes("--no-watch");
const shell = start(
  "pnpm",
  ["--filter", "@suite/desktop", watch ? "dev:shell:watch" : "dev:shell"],
  { SUITE_DESKTOP_DEV_URL: origin, FORCE_COLOR: "1" },
);

shell.on("exit", (code) => {
  stopAll();
  process.exit(code ?? 0);
});
