#!/usr/bin/env node
/**
 * The published maximum, measured.
 *
 * Runs a real relay (`tsx src/server.ts`) against a seeded workspace of the
 * requested size, opens the requested number of share rooms at the requested
 * peer count, drives edits, and prints what it actually measured: rooms,
 * document size, peers, p50 and p99 latency, peak RSS and event-loop lag.
 *
 * Every number comes from the relay's own `/metrics` or from a real Loro client
 * per peer, so the report cannot claim something the server did not do. The one
 * estimate is the lag percentile, which is interpolated from the exported
 * histogram buckets and labelled as such in the report.
 *
 *   pnpm --filter @suite/collab-server bench:load
 *   node bench/load.mjs --cards=2000 --rooms=8 --peers=8 --edits=20
 *
 * The profile is explicit on purpose: `--cards`, `--rooms`, `--peers` and
 * `--edits` are printed with the result, so two runs can be compared.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { cpus, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { registerTypeScript } from "../../../scripts/ts-loader.mjs";

registerTypeScript();

const { LoroAdaptor } = await import("loro-adaptors/loro");
const { LoroDoc } = await import("loro-crdt");
const { LoroWebsocketClient } = await import("loro-websocket");
const { WorkspaceDocument } = await import("@suite/graph");
const { createDocumentStore } = await import("../src/store/persistence.ts");
const { createShareStore } = await import("../src/store/shares.ts");
const { createWorkspaceOrgStore } = await import("../src/store/workspaceOrgs.ts");

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const repoRoot = resolve(serverRoot, "..", "..");

const WORKSPACE_ID = "bench-workspace";
const BOARD_ID = "board-bench";
const SOURCE_TOKEN = "bench-source-token";
const PROJECTION_TOKEN = "bench-projection-token";
const ADMIN_TOKEN = "bench-admin-token";

/* --------------------------------- options --------------------------------- */

function flag(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  if (found === undefined) return fallback;
  const value = Number(found.slice(prefix.length));
  if (!Number.isFinite(value) || value < 1) throw new Error(`--${name} must be a number >= 1`);
  return Math.floor(value);
}

const options = {
  cards: flag("cards", 2000),
  rooms: flag("rooms", 8),
  peers: flag("peers", 8),
  edits: flag("edits", 20),
  writeJson: process.argv.includes("--json"),
  keep: process.argv.includes("--keep"),
  verbose: process.argv.includes("--verbose"),
};

/* --------------------------------- helpers --------------------------------- */

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return Number((sorted[rank] ?? 0).toFixed(2));
}

/**
 * A percentile from a Prometheus histogram: the bucket the quantile falls in is
 * interpolated linearly, so the value is within one bucket width of the truth.
 */
function histogramPercentile(buckets, quantile) {
  const total = buckets.at(-1)?.count ?? 0;
  if (total === 0) return null;
  const wanted = quantile * total;
  let lowerBound = 0;
  let lowerCount = 0;
  for (const bucket of buckets) {
    if (bucket.count < wanted) {
      lowerBound = Number.isFinite(bucket.bound) ? bucket.bound : lowerBound;
      lowerCount = bucket.count;
      continue;
    }
    if (!Number.isFinite(bucket.bound)) return null;
    const span = bucket.count - lowerCount;
    const within = span === 0 ? 0 : (wanted - lowerCount) / span;
    return Number((lowerBound + (bucket.bound - lowerBound) * within).toFixed(4));
  }
  return null;
}

function parseHistogram(text, name) {
  const buckets = [];
  const pattern = new RegExp(`^${name}_bucket\\{le="([^"]+)"\\} (\\d+)$`, "u");
  for (const line of text.split("\n")) {
    const match = pattern.exec(line);
    if (match === null) continue;
    buckets.push({
      bound: match[1] === "+Inf" ? Number.POSITIVE_INFINITY : Number(match[1]),
      count: Number(match[2]),
    });
  }
  return buckets;
}

function parseGauge(text, name) {
  const match = new RegExp(`^${name} (\\d+(?:\\.\\d+)?)$`, "mu").exec(text);
  return match === null ? null : Number(match[1]);
}

async function waitForHealth(baseUrl, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await delay(150);
  }
  throw new Error("the relay did not answer /health");
}

/* --------------------------------- seeding --------------------------------- */

function seedStores(directory) {
  const documents = createDocumentStore(join(directory, "documents.sqlite"));
  const shares = createShareStore(join(directory, "shares.sqlite"));
  const orgs = createWorkspaceOrgStore(join(directory, "workspaces.sqlite"));

  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  workspace.markSeeded();
  workspace.createBoard({ id: BOARD_ID, name: "Bench board" });
  for (let index = 0; index < options.cards; index += 1) {
    workspace.createCard({
      id: `card-${String(index)}`,
      typeId: "note",
      boardId: BOARD_ID,
      position: { x: (index % 40) * 260, y: Math.floor(index / 40) * 200 },
    });
  }
  const snapshot = workspace.doc.export({ mode: "snapshot" });
  documents.save(`%LOR:${WORKSPACE_ID}`, snapshot);
  documents.close();

  // An editor share is what lets the worker's source token write the workspace
  // room, so the bench edits the way the relay does rather than around it.
  shares.create({ workspaceId: WORKSPACE_ID, scope: "board", role: "editor", boardId: BOARD_ID });
  const viewers = [];
  for (let index = 0; index < options.rooms; index += 1) {
    const created = shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
      expiresAt: null,
    });
    viewers.push({ token: created.token, roomId: created.share.roomId });
  }
  shares.close();
  orgs.close();
  return { viewers, documentBytes: snapshot.byteLength };
}

/* ------------------------------- measurement ------------------------------- */

async function openPeer(url, roomId, token) {
  const doc = new LoroDoc();
  const client = new LoroWebsocketClient({ url });
  const adaptor = new LoroAdaptor(doc);
  const room = await client.join({
    roomId,
    crdtAdaptor: adaptor,
    auth: () => new TextEncoder().encode(token),
  });
  return { client, doc, room, adaptor };
}

const placementX = (doc) => new WorkspaceDocument(doc).getPlacement(BOARD_ID, "card-0")?.x ?? null;

async function main() {
  const directory = mkdtempSync(join(here, ".run-"));
  const port = await freePort();
  const healthPort = await freePort();
  const wsUrl = `ws://127.0.0.1:${String(port)}`;
  const apiUrl = `http://127.0.0.1:${String(healthPort)}`;
  const seeded = seedStores(directory);

  // `tsx` is a dev dependency of this package, installed either beside it or at
  // the workspace root depending on how pnpm linked it.
  const tsx = [
    join(serverRoot, "node_modules/.bin/tsx"),
    join(repoRoot, "node_modules/.bin/tsx"),
  ].find((path) => existsSync(path));
  if (tsx === undefined) throw new Error("tsx is not installed; run `pnpm install` first");

  const relay = spawn(tsx, ["src/server.ts"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HEALTH_PORT: String(healthPort),
      SUITE_DB: join(directory, "documents.sqlite"),
      SUITE_SHARES_DB: join(directory, "shares.sqlite"),
      SUITE_WORKSPACES_DB: join(directory, "workspaces.sqlite"),
      SUITE_SETTINGS_DB: join(directory, "settings.sqlite"),
      SUITE_ATTACHMENTS_DB: join(directory, "attachments.sqlite"),
      SUITE_ADMIN_TOKEN: ADMIN_TOKEN,
      SUITE_SOURCE_TOKEN: SOURCE_TOKEN,
      SUITE_PROJECTION_TOKEN: PROJECTION_TOKEN,
      SUITE_LOG_LEVEL: options.verbose ? "debug" : "warn",
      SUITE_EVENT_LOOP_LAG_MS: "50",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const relayLog = [];
  relay.stdout.on("data", (chunk) => {
    relayLog.push(String(chunk));
    if (options.verbose) process.stderr.write(String(chunk));
  });
  relay.stderr.on("data", (chunk) => relayLog.push(String(chunk)));

  const metrics = [];
  const sample = async () => {
    try {
      const response = await fetch(`${apiUrl}/metrics`, {
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      if (response.ok) metrics.push(await response.text());
    } catch {
      // The relay is going away; the last sample is the one that counts.
    }
  };
  const sampler = setInterval(() => void sample(), 500);
  sampler.unref();

  const peers = [];
  const owners = [];
  const socketLatency = [];
  const shareLatency = [];
  const missed = [];
  const perEdit = [];

  try {
    await waitForHealth(apiUrl);

    // Resolving a link is what opens its projection room, exactly as a reader
    // does in a browser.
    for (const viewer of seeded.viewers) {
      const response = await fetch(`${apiUrl}/api/shares/${viewer.token}`);
      if (!response.ok) throw new Error(`resolving a share failed: ${response.status}`);
    }

    const writer = await openPeer(wsUrl, WORKSPACE_ID, SOURCE_TOKEN);
    const echo = await openPeer(wsUrl, WORKSPACE_ID, SOURCE_TOKEN);
    owners.push(writer, echo);
    for (const viewer of seeded.viewers) {
      for (let index = 0; index < options.peers; index += 1) {
        peers.push(await openPeer(wsUrl, viewer.roomId, viewer.token));
      }
    }

    // Both owner sessions must hold the seeded document before an edit is
    // timed: an edit against a document that has not arrived yet changes
    // nothing, and the measurement would report a timeout nobody caused.
    const readyDeadline = Date.now() + 60_000;
    while (Date.now() < readyDeadline && placementX(writer.doc) === null) await delay(50);
    const writerReady = placementX(writer.doc) !== null;
    if (!writerReady) throw new Error("the owner session never received the seeded document");
    // Let the first projection land before anything is timed.
    await delay(4000);

    for (let edit = 0; edit < options.edits; edit += 1) {
      const x = 1000 + edit;
      const started = performance.now();
      new WorkspaceDocument(writer.doc).placeCard(BOARD_ID, "card-0", { x, y: 0 });
      writer.doc.commit({ origin: "bench:edit" });

      const echoDeadline = started + 10_000;
      while (performance.now() < echoDeadline && placementX(echo.doc) !== x) await delay(2);
      const socketMs = placementX(echo.doc) === x ? performance.now() - started : null;
      if (socketMs !== null) socketLatency.push(socketMs);

      const shareDeadline = started + 60_000;
      let slowest = null;
      for (const peer of peers) {
        while (performance.now() < shareDeadline && placementX(peer.doc) !== x) await delay(4);
        const arrived = placementX(peer.doc) === x;
        if (!arrived) {
          missed.push({ edit, room: peer.room.roomId ?? null });
          slowest = null;
          break;
        }
        slowest = Math.max(slowest ?? 0, performance.now() - started);
      }
      if (slowest !== null) shareLatency.push(slowest);
      perEdit.push({
        edit,
        socketMs: socketMs === null ? null : Number(socketMs.toFixed(2)),
        shareMs: slowest === null ? null : Number(slowest.toFixed(2)),
      });
    }

    await sample();
  } finally {
    clearInterval(sampler);
    for (const peer of [...peers, ...owners]) {
      await peer.room.leave().catch(() => undefined);
      peer.adaptor.destroy();
      peer.client.close();
    }
    relay.kill("SIGTERM");
    await new Promise((done) => {
      if (relay.exitCode !== null) done(undefined);
      else relay.once("exit", done);
    });

    const last = metrics.at(-1) ?? "";
    const lagBuckets = parseHistogram(last, "suite_event_loop_lag_seconds");
    const lagSamples = lagBuckets.at(-1)?.count ?? 0;
    const rssPeak = Math.max(0, ...metrics.map((text) => parseGauge(text, "suite_rss_bytes") ?? 0));
    const report = {
      measuredAt: new Date().toISOString(),
      hardware: {
        platform: `${process.platform} ${process.arch}`,
        cpus: cpus().length,
        cpuModel: cpus()[0]?.model ?? "unknown",
        memoryBytes: totalmem(),
        node: process.version,
      },
      profile: {
        cards: options.cards,
        rooms: options.rooms,
        peersPerRoom: options.peers,
        peers: peers.length,
        edits: options.edits,
        documentBytes: seeded.documentBytes,
      },
      latency: {
        socketMs: {
          p50: percentile(socketLatency, 0.5),
          p99: percentile(socketLatency, 0.99),
          samples: socketLatency.length,
        },
        shareMs: {
          p50: percentile(shareLatency, 0.5),
          p99: percentile(shareLatency, 0.99),
          samples: shareLatency.length,
        },
      },
      eventLoopLagSeconds: {
        p50: histogramPercentile(lagBuckets, 0.5),
        p99: histogramPercentile(lagBuckets, 0.99),
        samples: lagSamples,
      },
      rssPeakBytes: rssPeak,
      edits: perEdit,
      metricsSamples: metrics.length,
      missedPropagations: missed.length,
      relayExitCode: relay.exitCode,
      relayLog: relayLog
        .join("")
        .split("\n")
        .filter((line) => line.includes('"level":"error"') || line.includes('"level":"warn"'))
        .slice(-10),
    };

    console.log(JSON.stringify(report, null, 2));
    if (options.writeJson) {
      writeFileSync(join(here, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    }
    if (!options.keep) rmSync(directory, { recursive: true, force: true });
    else console.log(`kept ${directory}`);
  }
}

await main();
