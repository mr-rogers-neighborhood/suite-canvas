#!/usr/bin/env node
/**
 * Runs a command on an X display the user cannot see.
 *
 * Why this exists: the ICE desk needs a real WebGPU adapter, and Playwright's
 * headless Chromium has none — it always reports `software · swiftshader` and
 * loses the device within a few seconds, so the specs that read what the canvas
 * draws cannot run headless at all. Headed Chrome works, but a headed window
 * steals focus and interrupts whoever is using the machine.
 *
 * A virtual X server splits the difference: Chrome believes it is headed (and
 * picks up the *hardware* adapter through the driver), while nothing is ever
 * mapped onto the user's screen. Measured on this machine: `hardware · nvidia /
 * ampere`, `engine: ready` held through zoom/fit/interaction at 42 fps, against
 * 1–2 fps on SwiftShader.
 *
 * Usage:
 *   node scripts/with-display.mjs <command> [args…]
 *
 * Environment:
 *   SUITE_ICE_VISIBLE=1    Skip the virtual display and run on the real one, so
 *                          the browser windows are watchable. Debugging only.
 *   SUITE_XVFB_DISPLAY=:99 Display number to use (default `:99`).
 *   SUITE_XVFB_SIZE        Xvfb screen size (default `1920x1080x24`).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const e2eDir = join(here, "..");

const DISPLAY = process.env.SUITE_XVFB_DISPLAY ?? ":99";
const SIZE = process.env.SUITE_XVFB_SIZE ?? "1920x1080x24";
/** Xvfb's lock file: whoever owns it owns the display, and we must not steal it. */
const LOCK = `/tmp/.X${DISPLAY.replace(":", "")}-lock`;

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("usage: node scripts/with-display.mjs <command> [args…]");
  process.exit(2);
}

/** The display is up once its lock exists and something answers for it. */
function displayIsUp() {
  return existsSync(LOCK);
}

async function startDisplay() {
  mkdirSync(join(e2eDir, "test-results"), { recursive: true });
  const child = spawn("Xvfb", [DISPLAY, "-screen", "0", SIZE, "-nolisten", "tcp"], {
    stdio: "ignore",
    detached: false,
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (displayIsUp() && existsSync(`/tmp/.X11-unix/X${DISPLAY.replace(":", "")}`)) return child;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Xvfb did not come up on ${DISPLAY} within 10s`);
}

/** Ctrl-C reaches the child through `spawn` in a terminal, but not when piped. */
function forwardSignals(child) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
}

async function main() {
  const visible = process.env.SUITE_ICE_VISIBLE === "1";
  let display;
  if (!visible) {
    if (!displayIsUp()) display = await startDisplay();
    // The ICE harness is what turns the desk specs on; on a virtual display there
    // is no reason to keep them off, so one command runs the whole gate.
    process.env.SUITE_ICE_E2E = process.env.SUITE_ICE_E2E ?? "1";
  }
  process.env.DISPLAY = visible ? (process.env.DISPLAY ?? ":0") : DISPLAY;

  const child = spawn(command, args, { stdio: "inherit", env: process.env, cwd: e2eDir });
  forwardSignals(child);
  const code = await new Promise((resolve) => child.on("exit", (value) => resolve(value ?? 1)));
  if (display !== undefined) {
    display.kill("SIGTERM");
    rmSync(LOCK, { force: true });
  }
  process.exit(code ?? 0);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
