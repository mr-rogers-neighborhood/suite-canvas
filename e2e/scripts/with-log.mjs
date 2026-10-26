#!/usr/bin/env node
/**
 * Runs a Playwright webServer command and copies its output to a file.
 *
 * Playwright pipes webServer output into the test run, which is enough until a
 * run is piped through `tail` or truncated by the terminal. Then the reason the
 * dev server exited is gone. `e2e:logs` reads these files.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [name, ...command] = process.argv.slice(2);
if (!name || command.length === 0) {
  console.error("usage: node scripts/with-log.mjs <name> <command> [args...]");
  process.exit(2);
}

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = path.join(E2E_DIR, ".artifacts");
mkdirSync(LOG_DIR, { recursive: true });

const log = createWriteStream(path.join(LOG_DIR, `${name}.log`), { flags: "a" });
const child = spawn(command[0], command.slice(1), {
  cwd: path.resolve(E2E_DIR, ".."),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
});

function forward(stream, target) {
  stream.on("data", (chunk) => {
    target.write(chunk);
    log.write(chunk);
  });
}

log.write(`\n[${new Date().toISOString()}] ${command.join(" ")}\n`);
forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);

function stop(signal) {
  try {
    child.kill(signal);
  } catch {
    // The child already exited.
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGHUP", () => stop("SIGHUP"));

child.on("error", (error) => {
  const line = `[${name}] failed to start: ${error.message}\n`;
  process.stderr.write(line);
  log.write(line);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  const line = `[${name}] exited (${signal ?? code ?? "unknown"})\n`;
  process.stderr.write(line);
  log.write(line);
  log.end();
  process.exit(code ?? 1);
});
