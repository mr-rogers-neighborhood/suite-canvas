#!/usr/bin/env node
/**
 * The throwaway Postgres the account specs run against.
 *
 * The relay keeps its documents in SQLite, so every suite before accounts needed
 * no database at all. The control plane does: accounts, organizations and
 * licences live in Postgres (ADR-0069), and the auth module refuses to boot
 * without it. The suite therefore owns a cluster the same way it owns the canvas
 * and the relay: one directory under `e2e/.data`, a fixed port the preflight can
 * see, and a lifetime that ends with the run.
 *
 * A fixed port rather than a free one on purpose. `preflight.mjs` can only report
 * or stop a process it can name, so a cluster left behind by a crashed run has to
 * be visible at a known port. It binds `127.0.0.1` and trusts local connections,
 * which is the same posture `scripts/db-verify.mjs` takes with its socket-only
 * cluster.
 *
 * The migration itself is the account service's job (`createMigratedAuthEntry`):
 * this file only makes sure a server is listening and a database exists.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The port the cluster listens on. Listed in `preflight.mjs` alongside the others. */
export const PG_PORT = 54329;

/** Where the cluster lives. `preflight.mjs --clean` removes it between runs. */
export const PG_DATA_DIR = path.join(E2E_DIR, ".data", "pg");

/** The database the control plane migrates, and this process creates. */
export const PG_DATABASE = "suite";

/** The superuser `initdb` creates. Trust auth, so no password ever exists. */
const PG_USER = "suite";

/** The connection string the control plane is handed. Trust auth, loopback only. */
export const PG_URL = `postgres://${PG_USER}@127.0.0.1:${PG_PORT}/${PG_DATABASE}`;

const LOG_PATH = path.join(E2E_DIR, ".data", "postgres.log");

/**
 * Where the server's unix socket goes. A packaged Postgres defaults to
 * `/run/postgresql`, which does not exist for a non-root user; pointing it inside
 * the run's own directory keeps the cluster self-contained and leaves the TCP
 * listener on loopback as the only door.
 */
const SOCKET_DIR = path.join(E2E_DIR, ".data", "pg-socket");

function installed(command) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" });
  return probe.error === undefined || probe.error.code !== "ENOENT";
}

function tail(file) {
  if (!existsSync(file)) return "(no server log)";
  return readFileSync(file, "utf8").trim().split("\n").slice(-20).join("\n");
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : error.message;
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr}`);
  }
}

/** Whether a server already answers on the e2e port. */
export function postgresAnswers() {
  const probe = spawnSync("pg_isready", ["-h", "127.0.0.1", "-p", String(PG_PORT), "-q"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

/** The pid `postmaster.pid` names, or null when the file is absent or stale. */
function runningPid() {
  const file = path.join(PG_DATA_DIR, "postmaster.pid");
  if (!existsSync(file)) return null;
  const pid = Number.parseInt(readFileSync(file, "utf8").split("\n")[0] ?? "", 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Stops the cluster this directory holds, if it is running. */
export function stopPostgres() {
  if (!existsSync(path.join(PG_DATA_DIR, "PG_VERSION"))) return;
  try {
    // `fast` is the mode that disconnects clients: `smart` would wait for them,
    // and the control plane's pool is exactly the client that is still attached.
    run("pg_ctl", ["-D", PG_DATA_DIR, "-m", "immediate", "-w", "stop"]);
  } catch {
    // A cluster that is already down, or one whose pid its own directory no
    // longer names, needs nothing from here.
  }
}

/**
 * Starts the cluster unless it is already answering, then makes sure the
 * database exists. Returns the connection string for the control plane.
 *
 * Idempotent within one Playwright run: `webServer` may be started once, but a
 * developer re-running a single spec against a live cluster should not pay for a
 * second `initdb`.
 */
export async function ensurePostgres() {
  if (!installed("initdb")) {
    throw new Error(
      "the account specs need Postgres: `initdb` is not on PATH, so the control plane cannot boot. Install PostgreSQL, or run a suite that does not include sharing/account.",
    );
  }
  for (const command of ["pg_ctl", "pg_isready", "psql", "createdb"]) {
    if (!installed(command)) {
      throw new Error(
        `${command} is missing while initdb is present — the Postgres install is incomplete`,
      );
    }
  }

  mkdirSync(path.dirname(PG_DATA_DIR), { recursive: true });

  if (!postgresAnswers()) {
    // A pid that survives a deleted data directory is the one case that has to be
    // killed explicitly: its socket is gone, so `pg_ctl` has nothing to talk to.
    const stale = runningPid();
    if (stale !== null) {
      try {
        process.kill(stale, "SIGKILL");
      } catch {
        // Already gone between the check and the signal.
      }
      await sleep(200);
    }
    if (existsSync(PG_DATA_DIR) && !existsSync(path.join(PG_DATA_DIR, "PG_VERSION"))) {
      rmSync(PG_DATA_DIR, { recursive: true, force: true });
    }
    rmSync(SOCKET_DIR, { recursive: true, force: true });
    mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o700 });
    if (!existsSync(path.join(PG_DATA_DIR, "PG_VERSION"))) {
      run("initdb", ["-D", PG_DATA_DIR, "-A", "trust", "-U", PG_USER, "--no-sync", "-E", "UTF8"]);
    }
    try {
      run("pg_ctl", [
        "-D",
        PG_DATA_DIR,
        "-l",
        LOG_PATH,
        "-o",
        `-p ${PG_PORT} -k ${SOCKET_DIR} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off`,
        "-w",
        "start",
      ]);
    } catch (error) {
      throw new Error(`${error.message}\n${tail(LOG_PATH)}`);
    }
  }

  // `CREATE DATABASE` has no `IF NOT EXISTS`, so ask the catalogue instead.
  const exists = run("psql", [
    "-h",
    "127.0.0.1",
    "-p",
    String(PG_PORT),
    "-U",
    PG_USER,
    "-d",
    "postgres",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname = '${PG_DATABASE}'`,
  ]).trim();
  if (exists !== "1") {
    run("createdb", ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", PG_USER, PG_DATABASE]);
  }

  return PG_URL;
}
