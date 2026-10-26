/**
 * Who is listening on a port, and how to stop them.
 *
 * Two harness files need this: `preflight.mjs`, which refuses to run while a stale
 * server owns a test port, and `global-teardown.mjs`, which has to close the
 * control plane before it stops the database under it. Both take the same care —
 * a process is named by its listener, never by its command line, so an unrelated
 * `node` on the machine is not a candidate.
 */
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

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

/** The pids listening on `port` that this user can see. */
export function listeners(port) {
  if (process.platform === "win32") return windowsListeners(port);
  if (process.platform === "darwin") return macListeners(port);
  return linuxListeners(port);
}

/** Whether anything holds the port, whether or not its owner is visible. */
export function portIsBusy(port) {
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

/** A pid, its age and its command line, for a preflight report. */
export function describe(pid) {
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

/**
 * Stops the listeners named, SIGTERM first and SIGKILL only if the port does not
 * free itself. Returns whether the port ended up free.
 */
export async function stopListeners(pids, port) {
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
