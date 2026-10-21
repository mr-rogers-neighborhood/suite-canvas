import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { WorkspaceDocument } from "./yjs/WorkspaceDocument.js";

/** Deterministic PRNG (mulberry32) so a failing seed reproduces exactly. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sync(a: Y.Doc, b: Y.Doc): void {
  const fromA = Y.encodeStateAsUpdate(a);
  const fromB = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(b, fromA, "sync");
  Y.applyUpdate(a, fromB, "sync");
}

/** A stable, order-independent view of everything the document exposes. */
function snapshot(workspace: WorkspaceDocument) {
  const byKey = <T extends { id: string }>(entries: T[]) =>
    [...entries].sort((left, right) => left.id.localeCompare(right.id));
  return {
    boards: byKey(workspace.listBoards()),
    cards: byKey(
      workspace.listCards().map((card) => ({
        ...card,
        connectors: byKey(card.connectors),
      })),
    ),
    placements: [...workspace.listPlacements()]
      .map((placement) => `${placement.boardId}/${placement.cardId}:${JSON.stringify(placement)}`)
      .sort(),
    edges: byKey(workspace.listEdges()).map((edge) => JSON.stringify(edge)),
  };
}

const BOARDS = ["b0", "b1"];
const CARDS = ["c0", "c1", "c2", "c3"];

/**
 * Applies a random edit. Both clients run this between syncs, so the two
 * documents deliberately produce conflicting writes.
 */
function randomEdit(workspace: WorkspaceDocument, next: () => number): void {
  const board = BOARDS[Math.floor(next() * BOARDS.length)] as string;
  const cardId = CARDS[Math.floor(next() * CARDS.length)] as string;
  const card = workspace.getCard(cardId);
  const connector = card?.connectors[Math.floor(next() * Math.max(1, card.connectors.length))];
  const edge =
    workspace.listEdges()[Math.floor(next() * Math.max(1, workspace.listEdges().length))];
  const pick = (index: number) => next() * index;

  switch (Math.floor(next() * 11)) {
    case 0:
      if (!card) workspace.createCard({ id: cardId, boardId: board, position: { x: 0, y: 0 } });
      break;
    case 1:
      workspace.placeCard(board, cardId, { x: Math.round(pick(400)), y: Math.round(pick(400)) });
      break;
    case 2:
      workspace.unplaceCard(board, cardId);
      break;
    case 3:
      workspace.updatePlacementSize(board, cardId, {
        width: 240 + Math.round(pick(200)),
        height: 120 + Math.round(pick(160)),
      });
      break;
    case 4:
      if (connector) workspace.moveConnector(cardId, connector.id, { x: next(), y: next() });
      else workspace.addConnector(cardId, { x: next(), y: next() });
      break;
    case 5:
      if (connector) workspace.removeConnector(cardId, connector.id);
      break;
    case 6:
      workspace.addEdge({
        boardId: board,
        source: CARDS[Math.floor(pick(CARDS.length))] as string,
        target: CARDS[Math.floor(pick(CARDS.length))] as string,
        ...(connector ? { sourceConnector: connector.id } : {}),
      });
      break;
    case 7:
      if (edge) workspace.setEdgeBidirectional(edge.id, next() > 0.5);
      break;
    case 8:
      if (edge) {
        const paths = ["bezier", "straight", "step", "smoothstep"] as const;
        workspace.setEdgePath(
          edge.id,
          paths[Math.floor(pick(paths.length))] as (typeof paths)[number],
        );
      }
      break;
    case 9:
      if (next() > 0.5) workspace.trashCard(cardId);
      else workspace.restoreCard(cardId);
      break;
    case 10:
      workspace.moveLayer(board, cardId, next() > 0.5 ? "front" : "backward");
      break;
    default:
      break;
  }
}

describe("workspace convergence", () => {
  it("converges after conflicting edits from two clients", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const next = random(seed);
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      const a = new WorkspaceDocument(docA);
      const b = new WorkspaceDocument(docB);

      a.createBoard({ id: BOARDS[0] as string });
      a.createCard({ id: CARDS[0] as string, boardId: BOARDS[0] as string });
      sync(docA, docB);

      for (let step = 0; step < 40; step += 1) {
        if (next() > 0.2) randomEdit(a, next);
        if (next() > 0.2) randomEdit(b, next);
        // Interleave syncs: sometimes both edit before merging, sometimes merge
        // after every op, which is what a real session looks like.
        if (next() > 0.35) sync(docA, docB);
      }

      sync(docA, docB);
      expect(snapshot(a), `seed ${seed}`).toEqual(snapshot(b));
      expect(snapshot(b), `seed ${seed} re-synced`).toEqual(snapshot(a));
    }
  });
});
