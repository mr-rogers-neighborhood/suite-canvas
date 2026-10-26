#!/usr/bin/env node
/**
 * Fails before Playwright starts when a dev server already owns a test port.
 *
 * The suite used to reuse whatever answered on :5173 and :1235. After a
 * refactor that meant a browser drove code from a process started hours
 * earlier, and the failure looked like a product bug. The first rule of this
 * harness is that every run owns its servers.
 *
 * `--fix` stops the listeners this script found. It never matches a process by
 * name, so an unrelated `node` process on the same machine is not a candidate.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(E2E_DIR, ".data");
const ARTIFACT_DIR = path.join(E2E_DIR, ".artifacts");
const args = new Set(process.argv.slice(2));
const fix = args.has("--fix");
const clean = args.has("--clean");
const visual = args.has("--visual");

const PORTS = [
  { port: 5173, name: "canvas dev server" },
  { port: 1234, name: "relay websocket" },
  { port: 1235, name: "relay health" },
  ...(visual ? [{ port: 6006, name: "storybook preview" }] : []),
];

function windowsListeners(port) {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [
      ...new Set(
        [...out.matchAll(new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "g"))].map((m) =>
          Number(m[1]),
        ),
      ),
    ];
  } catch {
    return [];
  }
}

function macListeners(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(out.split("\n").map(Number).filter(Number.isInteger))];
  } catch {
    return [];
  }
}

function linuxListeners(port) {
  try {
    const out = execFileSync("ss", ["-H", "-ltnp", `sport = :${port}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))];
  } catch {
    return [];
  }
}

function listeners(port) {
  if (process.platform === "win32") return windowsListeners(port);
  if (process.platform === "darwin") return macListeners(port);
  return linuxListeners(port);
}

function portIsBusy(port) {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.includes(`:${port}`) && out.includes("LISTENING");
    } catch {
      return false;
    }
  }
  if (process.platform === "darwin") {
    try {
      execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }
  try {
    const out = execFileSync("ss", ["-H", "-ltn", `sport = :${port}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function describe(pid) {
  try {
    const out = execFileSync("ps", ["-o", "pid=,etime=,command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.replace(/\s+/g, " ") || `pid ${pid}`;
  } catch {
    return `pid ${pid} (process details unavailable)`;
  }
}

async function stop(pids, port) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between the scan and the signal.
    }
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (!portIsBusy(port)) return true;
    await sleep(200);
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!portIsBusy(port)) return true;
    await sleep(200);
  }
  return false;
}

if (clean) {
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
}
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(ARTIFACT_DIR, { recursive: true });

let blocked = false;
for (const { port, name } of PORTS) {
  const pids = listeners(port);
  if (pids.length === 0) {
    if (!portIsBusy(port)) {
      console.log(`e2e preflight: ${name} :${port} is free`);
      continue;
    }
    console.error(`e2e preflight: ${name} :${port} is in use, but the owning process is hidden.`);
    blocked = true;
    continue;
  }

  console.error(`e2e preflight: ${name} :${port} is already in use:`);
  for (const pid of pids) console.error(`  ${describe(pid)}`);

  if (!fix) {
    blocked = true;
    continue;
  }

  const stopped = await stop(pids, port);
  if (stopped) {
    console.log(`e2e preflight: stopped ${name} :${port}`);
  } else {
    console.error(`e2e preflight: could not stop ${name} :${port}`);
    blocked = true;
  }
}

if (blocked) {
  console.error("");
  console.error("Stale servers make the suite reuse old code. Run `pnpm e2e:stop`, then retry.");
  process.exit(1);
}

console.log("e2e preflight: ports are clear");
