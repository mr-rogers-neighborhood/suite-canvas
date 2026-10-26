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
 *
 * `--clean` throws the run's data away, so it acts only *after* the port scan has
 * proved nothing else is using it. Doing it first was a harness bug with a real
 * footprint: a second `pnpm e2e:*` started while another run was live deleted that
 * run's database and stopped its Postgres, and the only symptoms were a control
 * plane exiting 1 and a handful of unrelated specs failing afterwards. The one
 * exception is the run's own Postgres, whose pid lives in this directory: a
 * cluster left behind by an interrupted run is stopped, because no live run can
 * own it.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, listeners, portIsBusy, stopListeners } from "./ports.mjs";
import { PG_PORT, stopPostgres } from "./postgres.mjs";

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
  // Accounts: the control plane, the origin its pages share, and the throwaway
  // Postgres behind it. All three belong to the run, so a leftover from a crashed
  // one is a reason to stop rather than to reuse.
  { port: 1236, name: "control plane" },
  { port: 5180, name: "hosted origin proxy" },
  { port: PG_PORT, name: "e2e Postgres" },
  ...(visual ? [{ port: 6006, name: "storybook preview" }] : []),
];

/**
 * Stops the cluster this run's directory holds, if anything is on its port.
 *
 * `stopPostgres` only ever acts on the pid in `e2e/.data/pg/postmaster.pid`, so it
 * cannot reach a Postgres somebody else started — and a run whose servers are all
 * gone cannot be using it.
 */
async function stopOrphanedCluster() {
  if (!portIsBusy(PG_PORT)) return true;
  stopPostgres();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (!portIsBusy(PG_PORT)) {
      console.log(`e2e preflight: stopped the run's leftover e2e Postgres :${PG_PORT}`);
      return true;
    }
    await sleep(200);
  }
  return false;
}

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(ARTIFACT_DIR, { recursive: true });

let blocked = false;
/** Whether anything other than the cluster holds a port — the cluster is stoppable, a live run is not. */
let serversBusy = false;

for (const { port, name } of PORTS) {
  const pids = listeners(port);
  if (pids.length === 0) {
    if (!portIsBusy(port)) {
      console.log(`e2e preflight: ${name} :${port} is free`);
      continue;
    }
    console.error(`e2e preflight: ${name} :${port} is in use, but the owning process is hidden.`);
    if (port !== PG_PORT) serversBusy = true;
    blocked = true;
    continue;
  }

  console.error(`e2e preflight: ${name} :${port} is already in use:`);
  for (const pid of pids) console.error(`  ${describe(pid)}`);
  if (port !== PG_PORT) serversBusy = true;

  if (!fix) {
    // The cluster is the exception: `--clean` stops it below, since an interrupted
    // run leaves it behind and nothing else can release the fixed port.
    if (port !== PG_PORT || !clean) blocked = true;
    continue;
  }

  const stopped = await stopListeners(pids, port);
  if (stopped) {
    console.log(`e2e preflight: stopped ${name} :${port}`);
  } else {
    console.error(`e2e preflight: could not stop ${name} :${port}`);
    blocked = true;
    serversBusy = true;
  }
}

// Only when nothing else of the suite is listening: stopping the cluster under a
// live control plane is exactly what killed a run before this checked for it.
if (clean && !serversBusy) {
  if (!(await stopOrphanedCluster())) {
    console.error(`e2e preflight: e2e Postgres :${PG_PORT} would not stop`);
    blocked = true;
  }
}

if (blocked) {
  console.error("");
  console.error("Stale servers make the suite reuse old code. Run `pnpm e2e:stop`, then retry.");
  process.exit(1);
}

// The ports are clear, so the data directory belongs to nobody: stop the cluster
// before its directory goes away (a Postgres whose data directory has been deleted
// under it cannot be asked to shut down afterwards).
if (clean) {
  stopPostgres();
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(ARTIFACT_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });
}

console.log("e2e preflight: ports are clear");
