#!/usr/bin/env node
/**
 * Cost per room and the CPU wall, measured by running `load.mjs` repeatedly.
 *
 * Three phases, because they answer three different questions:
 *
 * - `memory` — 1, 4, 16, 32, 64 and 128 projection rooms at a fixed card count
 *   and one peer per room, a fresh relay per point. Regresses the steady state
 *   against room count: the intercept is what the relay costs before anyone
 *   connects, the slope is what one more open room costs.
 * - `edits` — a fixed room count, raising the edits per second. This is the
 *   criterion the plan names: event-loop lag p99 over 100 ms.
 * - `load` — a fixed offered rate of one edit per save window, raising the room
 *   count. This is the ceiling that matters: when the per-window projection work
 *   exceeds the window, the relay stops keeping up and edits stop arriving.
 *
 * Every point is its own `node bench/load.mjs` process, so one run's documents,
 * WASM memory and rooms cannot leak into the next. What each run reports is the
 * relay's own `/metrics`, scraped and parsed by `load.mjs`; nothing here
 * estimates memory.
 *
 *   node bench/sweep.mjs                      # all three phases
 *   node bench/sweep.mjs --phase=memory
 *   node bench/sweep.mjs --phase=edits --edit-rooms=16 --edit-rates=0.25,1,4,16
 *
 * Writes `bench/sweep.json` (raw per-run reports plus the regression) and prints
 * the tables `docs/reference/capacity.md` quotes.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const loadScript = join(here, "load.mjs");
const MiB = 1024 * 1024;

/* --------------------------------- options --------------------------------- */

function listFlag(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  const text = found === undefined ? fallback : found.slice(prefix.length);
  const values = text
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) throw new Error(`--${name} needs at least one positive number`);
  return values;
}

function flag(name, fallback) {
  return listFlag(name, String(fallback))[0] ?? fallback;
}

const phases = (() => {
  const prefix = "--phase=";
  const found = process.argv.find((value) => value.startsWith(prefix));
  const name = found === undefined ? "all" : found.slice(prefix.length);
  if (!["all", "memory", "edits", "load"].includes(name)) {
    throw new Error("--phase must be one of all, memory, edits, load");
  }
  return name === "all" ? ["memory", "edits", "load"] : [name];
})();

const options = {
  cards: flag("cards", 200),
  peers: flag("peers", 1),
  settle: flag("settle", 3_000),
  steadySamples: flag("steady-samples", 3),
  memoryRooms: listFlag("memory-rooms", "1,4,16,32,64,128"),
  editRooms: flag("edit-rooms", 16),
  editRates: listFlag("edit-rates", "0.25,1,4,16"),
  loadRooms: listFlag("load-rooms", "16,32,64,128"),
  loadRate: flag("load-rate", 0.45),
  driveSeconds: flag("drive-seconds", 20),
  deliveryMs: flag("delivery-ms", 30_000),
  out: process.argv.find((value) => value.startsWith("--out="))?.slice(6) ?? "sweep.json",
};

/* --------------------------------- running --------------------------------- */

/** One `load.mjs` run, parsed. Rejects on a non-zero exit or unparsable output. */
function runLoad({ rooms, edits, rate = null }) {
  const args = [
    loadScript,
    `--cards=${String(options.cards)}`,
    `--rooms=${String(rooms)}`,
    `--peers=${String(options.peers)}`,
    `--edits=${String(edits)}`,
    `--settle=${String(options.settle)}`,
    `--steady-samples=${String(options.steadySamples)}`,
    `--delivery-ms=${String(options.deliveryMs)}`,
  ];
  if (rate !== null) args.push(`--rate=${String(rate)}`);

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(
      () => {
        child.kill("SIGKILL");
        rejectRun(new Error(`the run at ${String(rooms)} rooms timed out`));
      },
      15 * 60 * 1_000,
    );
    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      const text = stdout.join("");
      if (code !== 0) {
        rejectRun(new Error(`load.mjs exited ${String(code)}: ${stderr.join("").slice(-400)}`));
        return;
      }
      try {
        resolveRun(JSON.parse(text));
      } catch (error) {
        rejectRun(new Error(`load.mjs printed no report: ${String(error)}`));
      }
    });
  });
}

/* -------------------------------- arithmetic ------------------------------- */

/**
 * Least squares on (x, y). `null` for fewer than two points, where a slope is
 * not a measurement. R² is 1 - SSres/SStot, and `null` when every y is equal,
 * because then there is no variation to explain.
 */
function regress(points) {
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const varianceX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (varianceX === 0) return null;
  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;
  const residuals = points.reduce(
    (sum, point) => sum + (point.y - (intercept + slope * point.x)) ** 2,
    0,
  );
  const total = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  return {
    points: points.length,
    intercept,
    slope,
    r2: total === 0 ? null : 1 - residuals / total,
  };
}

/** A run without its per-edit firing log; the aggregates are what any table uses. */
function summarise(report) {
  const { edits, ...rest } = report;
  return { ...rest, editTimesRecorded: edits.length };
}

const mib = (bytes) => (typeof bytes === "number" ? Number((bytes / MiB).toFixed(1)) : null);
const millis = (seconds) =>
  typeof seconds === "number" ? Number((seconds * 1_000).toFixed(2)) : null;
const round = (value, digits = 2) =>
  typeof value === "number" ? Number(value.toFixed(digits)) : null;

/* ---------------------------------- phases --------------------------------- */

async function memoryPhase() {
  const runs = [];
  for (const rooms of options.memoryRooms) {
    process.stderr.write(`memory: ${String(rooms)} rooms… `);
    const report = await runLoad({ rooms, edits: 2 });
    process.stderr.write(`rss ${String(mib(report.steady.rssBytes))} MiB\n`);
    runs.push({ rooms, report: summarise(report) });
  }
  const points = (field) => runs.map((run) => ({ x: run.rooms, y: run.report.steady[field] }));
  return {
    phase: "memory",
    profile: {
      cards: options.cards,
      peersPerRoom: options.peers,
      edits: 2,
      settleMs: options.settle,
    },
    runs,
    regression: {
      rssBytes: regress(points("rssBytes")),
      arrayBuffersBytes: regress(points("arrayBuffersBytes")),
      externalBytes: regress(points("externalBytes")),
      heapBytes: regress(points("heapBytes")),
    },
  };
}

async function editsPhase() {
  const runs = [];
  for (const rate of options.editRates) {
    const edits = Math.max(6, Math.round(rate * options.driveSeconds));
    process.stderr.write(`edits: ${String(rate)}/s over ${String(edits)} edits… `);
    const report = await runLoad({ rooms: options.editRooms, edits, rate });
    process.stderr.write(`lag p99 ${String(millis(report.eventLoopLagSeconds.p99))} ms\n`);
    runs.push({ rate, edits, report: summarise(report) });
  }
  const crossing = runs.find((run) => (run.report.eventLoopLagSeconds.p99 ?? 0) >= 0.1);
  return {
    phase: "edits",
    profile: {
      rooms: options.editRooms,
      cards: options.cards,
      peersPerRoom: options.peers,
      driveSeconds: options.driveSeconds,
    },
    runs,
    p99CrossingRate: crossing?.rate ?? null,
  };
}

async function loadPhase() {
  const runs = [];
  const edits = Math.max(6, Math.round(options.loadRate * options.driveSeconds));
  for (const rooms of options.loadRooms) {
    process.stderr.write(`load: ${String(rooms)} rooms at ${String(options.loadRate)}/s… `);
    const report = await runLoad({ rooms, edits, rate: options.loadRate });
    process.stderr.write(
      `lag p50 ${String(millis(report.eventLoopLagSeconds.p50))} ms, missed ${String(report.missedPropagations)}\n`,
    );
    runs.push({ rooms, edits, report });
  }
  // "Stopped keeping up" is a delivery fact, not a percentile: a peer still
  // waiting after the deadline, or a delivery tail past two save windows. A
  // build cap or a lag p50 of a second also counts.
  const saturated = runs.find((run) => {
    const delivery = run.report.profile.rateDelivery;
    return (
      (delivery?.undelivered ?? 0) > 0 ||
      (delivery?.p99Ms ?? 0) > 4_400 ||
      (run.report.eventLoopLagSeconds.p50 ?? 0) >= 1 ||
      (run.report.final.projectionCapped ?? 0) > 0
    );
  });
  return {
    phase: "load",
    profile: {
      cards: options.cards,
      peersPerRoom: options.peers,
      editsPerSecond: options.loadRate,
      edits,
      driveSeconds: options.driveSeconds,
    },
    runs,
    saturatedRooms: saturated?.rooms ?? null,
  };
}

/* --------------------------------- printing -------------------------------- */

function printMemory(result) {
  console.log(
    "\n| Rooms | RSS MiB | arrayBuffers MiB | external MiB | heap MiB | projection rooms | document bytes |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const { rooms, report } of result.runs) {
    console.log(
      `| ${String(rooms)} | ${String(mib(report.steady.rssBytes))} | ${String(mib(report.steady.arrayBuffersBytes))} | ${String(mib(report.steady.externalBytes))} | ${String(mib(report.steady.heapBytes))} | ${String(report.steady.projectionRooms)} | ${String(report.profile.documentBytes)} |`,
    );
  }

  console.log("\nRegression (least squares, y = intercept + slope × rooms):");
  for (const [field, fit] of Object.entries(result.regression)) {
    if (fit === null) {
      console.log(`- ${field}: fewer than two points`);
      continue;
    }
    const r2 = fit.r2 === null ? "n/a" : String(round(fit.r2, 4));
    console.log(
      `- ${field}: intercept ${String(round(fit.intercept))} B, slope ${String(round(fit.slope))} B/room (${String(round(fit.slope / MiB))} MiB/room), R² ${r2}`,
    );
  }
}

function printEdits(result) {
  console.log(
    `\nEdits phase: ${String(result.profile.rooms)} rooms, ${String(result.profile.cards)} cards`,
  );
  console.log(
    "| Edits/s | Edits | Lag p50 ms | Lag p99 ms | samples ≥ 100 ms | samples | breaches | capped | delivery p50 ms |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const { rate, edits, report } of result.runs) {
    const lag = report.eventLoopLagSeconds;
    const delivery = report.profile.rateDelivery;
    console.log(
      `| ${String(rate)} | ${String(edits)} | ${String(millis(lag.p50))} | ${String(millis(lag.p99))} | ${String(lag.atOrAbove100ms)} | ${String(lag.samples)} | ${String(report.final.eventLoopLagBreaches)} | ${String(report.final.projectionCapped)} | ${String(delivery?.p50Ms ?? null)} |`,
    );
  }
  console.log(
    `\nLowest rate whose lag p99 crosses 100 ms: ${result.p99CrossingRate === null ? "none measured" : `${String(result.p99CrossingRate)}/s`}`,
  );
}

function printLoad(result) {
  console.log(
    `\nLoad phase: ${String(result.profile.editsPerSecond)} edits/s, ${String(result.profile.cards)} cards`,
  );
  console.log(
    "| Rooms | Lag p50 ms | Lag p99 ms | samples ≥ 100 ms | samples | capped | delivery p50 ms | delivery p99 ms | delivered |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const { rooms, report } of result.runs) {
    const lag = report.eventLoopLagSeconds;
    const delivery = report.profile.rateDelivery;
    const delivered =
      delivery === null ? "n/a" : `${String(delivery.delivered)}/${String(delivery.peers)}`;
    console.log(
      `| ${String(rooms)} | ${String(millis(lag.p50))} | ${String(millis(lag.p99))} | ${String(lag.atOrAbove100ms)} | ${String(lag.samples)} | ${String(report.final.projectionCapped)} | ${String(delivery?.p50Ms ?? null)} | ${String(delivery?.p99Ms ?? null)} | ${delivered} |`,
    );
  }
  console.log(
    `\nFirst room count that stops keeping up: ${result.saturatedRooms === null ? "not reached" : String(result.saturatedRooms)}`,
  );
}

/* ----------------------------------- main ---------------------------------- */

const results = [];
const outPath = join(here, options.out);
try {
  // A phase can be re-run on its own: results already in the file for phases
  // this invocation does not run are kept, in their original order.
  const existing = JSON.parse(readFileSync(outPath, "utf8"));
  for (const entry of existing.results ?? []) {
    if (!phases.includes(entry.phase)) results.push(entry);
  }
} catch {
  // No previous sweep, or an unreadable one: start from nothing.
}
for (const phase of phases) {
  if (phase === "memory") {
    const result = await memoryPhase();
    printMemory(result);
    results.push(result);
  } else if (phase === "edits") {
    const result = await editsPhase();
    printEdits(result);
    results.push(result);
  } else {
    const result = await loadPhase();
    printLoad(result);
    results.push(result);
  }
}

const ordered = ["memory", "edits", "load"].flatMap((phase) =>
  results.filter((entry) => entry.phase === phase),
);
writeFileSync(
  outPath,
  `${JSON.stringify({ measuredAt: new Date().toISOString(), phases, options, results: ordered }, null, 2)}\n`,
);
console.log(`\nwrote ${outPath}`);
