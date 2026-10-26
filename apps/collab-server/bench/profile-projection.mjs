#!/usr/bin/env node
/**
 * Where a share rebuild's time goes, stage by stage.
 *
 * `bench:load` measures the latency a reader feels but not what inside the relay
 * spends it. This script builds the same board `load.mjs` seeds (same ids, same
 * sizes), then times the stages of `projectInto` against it in-process, on the
 * documents the relay holds: the source workspace and a viewer room.
 *
 * Costs are reported for a room that already holds the previous projection — the
 * steady state a live share runs in — and for the two ways of writing the next
 * one into it: a full clear-and-rewrite (`applyProjection`) and a mirror that
 * writes only the difference (`mirrorWorkspace`).
 *
 *   node apps/collab-server/bench/profile-projection.mjs
 *   node apps/collab-server/bench/profile-projection.mjs --cards=500 --repeats=5
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTypeScript } from "../../../scripts/ts-loader.mjs";

registerTypeScript();

const { LoroDoc } = await import("loro-crdt");
const { applyProjection, projectWorkspace, WorkspaceDocument } = await import("@suite/graph");
const { mirrorWorkspace } = await import("../src/projection/mirror.ts");
const { measureRoom, persistBaseline } = await import("../src/projection/snapshot.ts");

const here = dirname(fileURLToPath(import.meta.url));

function flag(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  if (found === undefined) return fallback;
  const value = Number(found.slice(prefix.length));
  if (!Number.isFinite(value) || value < 1) throw new Error(`--${name} must be a number >= 1`);
  return Math.floor(value);
}

const CARDS = flag("cards", 200);
const REPEATS = flag("repeats", 4);
const BOARD_ID = "board-bench";

/** The fixture `load.mjs` seeds: one board, `CARDS` plain note cards. */
function buildSource() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  workspace.markSeeded();
  workspace.createBoard({ id: BOARD_ID, name: "Bench board" });
  for (let index = 0; index < CARDS; index += 1) {
    workspace.createCard({
      id: `card-${String(index)}`,
      typeId: "note",
      boardId: BOARD_ID,
      position: { x: (index % 40) * 260, y: Math.floor(index / 40) * 200 },
    });
  }
  return workspace;
}

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const target = { scope: "board", boardId: BOARD_ID };

/** A room document, shaped like the one `openRoom` builds. */
function room(role) {
  const doc = new LoroDoc();
  return {
    doc,
    shareId: "share-profile",
    role,
    bytes: 0,
    measured: doc.version(),
    workspace: new WorkspaceDocument(doc),
  };
}

const source = buildSource();
const documentBytes = source.doc.export({ mode: "snapshot" }).length;
const shares = {
  getBaseline: () => null,
  setBaseline: () => {},
  deleteBaseline: () => {},
  list: () => [],
};
const deps = {
  documents: { load: () => null },
  shares,
  sources: new Map(),
  touch: () => {},
  warn: () => {},
  now: () => 0,
  maxCards: 2000,
  buildCapMs: 5000,
  report: () => {},
};

const samples = [];
function sample(label, work) {
  const started = nowMs();
  const result = work();
  samples.push({ label, ms: nowMs() - started });
  return result;
}

const first = projectWorkspace(source, target);
console.log(
  JSON.stringify(
    { fixture: { cards: CARDS, documentBytes, repeats: REPEATS }, note: "stage costs per room" },
    null,
    2,
  ),
);

for (let repeat = 0; repeat < REPEATS; repeat += 1) {
  // A save that moved one card: the smallest real source change there is.
  source.placeCard(BOARD_ID, "card-0", { x: 1_000 + repeat, y: 0 });
  source.doc.commit({ origin: "bench:edit" });

  const next = sample("projectWorkspace", () => projectWorkspace(source, target)).workspace;

  const full = room("viewer");
  applyProjection(full.workspace, first.workspace);
  sample("applyProjection (clear + rewrite)", () => applyProjection(full.workspace, next));

  const incremental = room("viewer");
  mirrorWorkspace(incremental.workspace, first.workspace);
  sample("mirrorWorkspace (unchanged projection)", () => {
    mirrorWorkspace(incremental.workspace, first.workspace);
  });
  sample("mirrorWorkspace (one card moved)", () => mirrorWorkspace(incremental.workspace, next));
  sample("measureRoom (update export)", () => measureRoom(incremental, () => {}));

  const editor = room("editor");
  mirrorWorkspace(editor.workspace, first.workspace);
  sample("persistBaseline (snapshot export + import)", () => persistBaseline(editor, deps));
}

const byLabel = new Map();
for (const entry of samples) {
  const list = byLabel.get(entry.label) ?? [];
  list.push(entry.ms);
  byLabel.set(entry.label, list);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

const rows = [...byLabel].map(([label, values]) => ({
  stage: label,
  medianMs: Number(median(values).toFixed(2)),
  minMs: Number(Math.min(...values).toFixed(2)),
  maxMs: Number(Math.max(...values).toFixed(2)),
}));

console.table(rows);
console.log(
  JSON.stringify(
    {
      beforePerRoomMs: rows.find((row) => row.stage.startsWith("applyProjection"))?.medianMs,
      afterPerRoomMs: rows.find((row) => row.stage === "mirrorWorkspace (one card moved)")
        ?.medianMs,
      script: resolve(here, "profile-projection.mjs"),
    },
    null,
    2,
  ),
);
