#!/usr/bin/env node
/**
 * What one rebuild costs a share room, after the first one.
 *
 * A share room keeps one document for the life of the room and every rebuild
 * writes into it, so what a rebuild *writes* is what the room carries from then
 * on: the update each viewer receives, the snapshot the relay re-serialises for
 * every inbound update, the row it stores, and the document a new reader has to
 * join. This script drives the same one-card edit repeatedly into two rooms —
 * one written by `applyProjection` (clear and rewrite) and one by
 * `mirrorWorkspace` (only the difference) — and prints what each cycle costs.
 *
 *   node apps/collab-server/bench/rebuild-cost.mjs
 *   node apps/collab-server/bench/rebuild-cost.mjs --cards=500 --cycles=8
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerTypeScript } from "../../../scripts/ts-loader.mjs";

registerTypeScript();

const { LoroDoc } = await import("loro-crdt");
const { applyProjection, projectWorkspace, WorkspaceDocument } = await import("@suite/graph");
const { mirrorWorkspace } = await import("../src/projection/mirror.ts");

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
const CYCLES = flag("cycles", 8);
const BOARD_ID = "board-bench";
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
const target = { scope: "board", boardId: BOARD_ID };

const source = new WorkspaceDocument();
source.ensureDefaultTypes();
source.markSeeded();
source.createBoard({ id: BOARD_ID, name: "Bench board" });
for (let index = 0; index < CARDS; index += 1) {
  source.createCard({
    id: `card-${String(index)}`,
    typeId: "note",
    boardId: BOARD_ID,
    position: { x: (index % 40) * 260, y: Math.floor(index / 40) * 200 },
  });
}

function room() {
  return new WorkspaceDocument(new LoroDoc());
}

const rewrite = room();
const incremental = room();
const rows = [];

for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
  // One card moved: the smallest source change a share has to follow.
  source.placeCard(BOARD_ID, "card-0", { x: 1_000 + cycle, y: 0 });
  source.doc.commit({ origin: "bench:edit" });
  const projection = projectWorkspace(source, target).workspace;

  const beforeRewrite = rewrite.doc.version();
  const rewriteStarted = nowMs();
  applyProjection(rewrite, projection);
  const rewriteMs = nowMs() - rewriteStarted;

  const beforeMirror = incremental.doc.version();
  const mirrorStarted = nowMs();
  mirrorWorkspace(incremental, projection);
  const mirrorMs = nowMs() - mirrorStarted;

  rows.push({
    cycle,
    rewriteMs: Number(rewriteMs.toFixed(1)),
    rewriteWrittenBytes: rewrite.doc.export({ mode: "update", from: beforeRewrite }).length,
    rewriteDocumentBytes: rewrite.doc.export({ mode: "snapshot" }).length,
    mirrorMs: Number(mirrorMs.toFixed(1)),
    mirrorWrittenBytes: incremental.doc.export({ mode: "update", from: beforeMirror }).length,
    mirrorDocumentBytes: incremental.doc.export({ mode: "snapshot" }).length,
  });
}

console.table(rows);
console.log(
  JSON.stringify(
    {
      fixture: { cards: CARDS, cycles: CYCLES },
      firstCycleRewriteBytes: rows[0]?.rewriteWrittenBytes,
      lastCycleRewriteBytes: rows.at(-1)?.rewriteWrittenBytes,
      lastCycleMirrorBytes: rows.at(-1)?.mirrorWrittenBytes,
      lastCycleRewriteDocumentBytes: rows.at(-1)?.rewriteDocumentBytes,
      lastCycleMirrorDocumentBytes: rows.at(-1)?.mirrorDocumentBytes,
      script: resolve(here, "rebuild-cost.mjs"),
    },
    null,
    2,
  ),
);
