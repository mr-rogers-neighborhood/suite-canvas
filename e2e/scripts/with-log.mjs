#!/usr/bin/env node
/**
 * Runs a Playwright webServer command and copies its output to a file.
 *
 * Playwright pipes webServer output into the test run, which is enough until a
 * run is piped through `tail` or truncated by the terminal. Then the reason the
 * dev server exited is gone. `e2e:logs` reads these files.
 *
 * It also owns the *reporting* of an exit. A web server that dies on its own used
 * to surface as a bare `[name] exited (1)` followed by specs failing on refused
 * connections, which reads as a product failure. Now the exit is announced with
 * the last lines this process wrote, so the reason travels with the failure.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
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

const LOG_PATH = path.join(LOG_DIR, `${name}.log`);
const log = createWriteStream(LOG_PATH, { flags: "a" });
const banner = `\n[${new Date().toISOString()}] ${command.join(" ")}\n`;
log.write(banner);
/** Where this run's output starts, so the tail below is this run's and no earlier one's. */
const offset = log.bytesWritten - banner.length;

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

forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);

let asking = false;

function stop(signal) {
  asking = true;
  try {
    child.kill(signal);
  } catch {
    // The child already exited.
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGHUP", () => stop("SIGHUP"));

/** The last lines this run wrote, so an exit carries its own explanation. */
function tailOfThisRun(lines = 12) {
  try {
    const text = readFileSync(LOG_PATH, "utf8").slice(offset);
    const tail = text.trimEnd().split("\n").slice(-lines).join("\n");
    return tail.length > 0 ? tail : "(the server wrote nothing)";
  } catch {
    return "(the log could not be read)";
  }
}

child.on("error", (error) => {
  const line = `[${name}] failed to start: ${error.message}\n`;
  process.stderr.write(line);
  log.write(line);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  const clean = asking || code === 0;
  const line = `[${name}] exited (${signal ?? code ?? "unknown"})${clean ? "" : " — it did not ask to"}\n`;
  process.stderr.write(line);
  log.write(line);
  if (!clean) {
    const failure = [
      "",
      `── ${name} stopped on its own; the reason is the end of its output ──`,
      tailOfThisRun(),
      `── full log: e2e/.artifacts/${name}.log ──`,
      "",
    ].join("\n");
    process.stderr.write(failure);
    log.write(failure);
  }
  log.end();
  process.exit(code ?? (clean ? 0 : 1));
});
