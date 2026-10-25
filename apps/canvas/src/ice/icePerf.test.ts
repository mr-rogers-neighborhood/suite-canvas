/**
 * The 1k/5k budget artifact (ADR-0034's P0 "Budget" row).
 *
 * What this measures is the part of a desk mount that is the product's own:
 * deriving the placements the desk spawns and planning the entity set
 * (`CardProjection.reconcile`). GPU frame time belongs to ICE and needs a
 * device; the lab's HUD reports it (`docs/roadmap/ice-parity.md` §9).
 *
 * **The 5k point is placements, not a document.** Creating 5 000 cards through
 * `WorkspaceDocument` costs about 90 seconds in Node and grows faster than
 * linearly (measured: 3.5 s for 1 000, 88 s for 5 000 geometric cards, i.e.
 * before any title or body is written), so a full 5k document is not a fixture a
 * test suite can afford. The 1k case is measured end to end — a real document,
 * its cards' text, and the entity plan — and the 5k case measures the same
 * entity plan over 5 000 canonical placements. The gap is named in the roadmap
 * rather than papered over.
 *
 * The budgets are smoke checks for an accidental superlinear pass, not targets —
 * a busy CI machine must not fail this for being busy.
 */

import { WorkspaceDocument } from "@suite/graph";
import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { type CanonicalPlacement, CardProjection } from "./iceCardProjection";

const COLUMNS = 40;
const NATURAL = { width: 288, height: 240 };
const BODY =
  "A card body is a few paragraphs of thinking, links and notes. ".repeat(4).trim() +
  "\n\nAnd a second paragraph, so the face has more than one flow to lay out.";
const BUDGET_MS = 20_000;
const FIXTURE_TIMEOUT_MS = 180_000;
/** A synthetic placement, the shape `canonicalPlacements()` produces. */
function placement(index: number): CanonicalPlacement {
  return {
    boardId: "perf-board",
    cardId: `perf-card-${index}`,
    x: (index % COLUMNS) * 300,
    y: Math.floor(index / COLUMNS) * 260,
    text: `Card ${index}\n\n${BODY}`,
  };
}

interface Fixture {
  readonly workspace: WorkspaceDocument;
  readonly boardId: string;
  readonly cards: number;
}

function writeParagraph(container: LoroMap, text: string): void {
  const children = container.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const textChildren = paragraph.ensureMergeableList("children");
  textChildren.insertContainer(0, new LoroText()).insert(0, text);
}

function buildFixture(cards: number): Fixture {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureView();
  workspace.batch("perf:seed", () => {
    for (let index = 0; index < cards; index += 1) {
      const card = workspace.createCard({
        id: `perf-card-${index}`,
        boardId: board.id,
        position: { x: (index % COLUMNS) * 300, y: Math.floor(index / COLUMNS) * 260 },
      });
      writeParagraph(workspace.getTitle(card.id), `Card ${index}`);
      writeParagraph(workspace.getContent(card.id), BODY);
    }
  });
  return { workspace, boardId: board.id, cards };
}

/**
 * The desk's own derivation, without an engine: every live placement on the
 * View, in its frame's units, with the text its paper writes. This mirrors
 * `useIceProjection`'s `canonicalPlacements()`; a change there should show up
 * here as a cost change, which is the point of the artifact.
 */
function placementsOf(fixture: Fixture): CanonicalPlacement[] {
  const { workspace, boardId } = fixture;
  return workspace.listBoardPlacements(boardId).flatMap((placement) => {
    const card = workspace.getCard(placement.cardId);
    if (card === undefined || card.deletedAt) return [];
    const body = workspace.cardText(placement.cardId).trim();
    const title = workspace.displayTitle(placement.cardId);
    return [
      {
        boardId: placement.boardId,
        cardId: placement.cardId,
        x: placement.x,
        y: placement.y,
        text: body.length === 0 ? title : `${title}\n\n${body}`,
        ...(placement.width === undefined ? {} : { width: placement.width }),
        ...(placement.height === undefined ? {} : { height: placement.height }),
        ...(placement.typeScale === undefined ? {} : { typeScale: placement.typeScale }),
      },
    ];
  });
}

interface ProjectionCost {
  readonly cards: number;
  readonly mountMs: number;
  readonly spawns: number;
  readonly heapMb: number;
}

/** The entity plan for a canonical placement list — the desk's mount. */
function mountCost(cards: number, placements: () => CanonicalPlacement[]): ProjectionCost {
  const startedHeap = process.memoryUsage().heapUsed;
  let minted = 0;
  const projection = new CardProjection<number>({
    spawn: () => {
      minted += 1;
      return minted;
    },
    remove: () => undefined,
    boxOf: () => null,
  });
  const all = placements();
  const started = performance.now();
  const report = projection.reconcile(all, NATURAL);
  const mountMs = performance.now() - started;
  expect(report.spawned).toHaveLength(cards);
  expect(report.failures).toEqual([]);
  const heapMb = (process.memoryUsage().heapUsed - startedHeap) / (1024 * 1024);
  return { cards, mountMs, spawns: minted, heapMb };
}

interface DocumentCost extends ProjectionCost {
  readonly buildMs: number;
  readonly deriveMs: number;
}

/** 1k end to end: a real document, its derived placements, and the entity plan. */
function measureDocument(cards: number): DocumentCost {
  const startedHeap = process.memoryUsage().heapUsed;
  const buildStart = performance.now();
  const fixture = buildFixture(cards);
  const buildMs = performance.now() - buildStart;

  const deriveStart = performance.now();
  const placements = placementsOf(fixture);
  const deriveMs = performance.now() - deriveStart;

  const cost = mountCost(cards, () => placements);
  const heapMb = (process.memoryUsage().heapUsed - startedHeap) / (1024 * 1024);
  return { ...cost, buildMs, deriveMs, heapMb };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

describe("the desk at 1k and 5k objects", () => {
  it(
    "should take a 1 000-card document from open to a mounted entity set",
    () => {
      const measured = measureDocument(1_000);
      console.info(
        `[ice-perf] 1000 cards (document) · build ${round(measured.buildMs)} ms · ` +
          `derive ${round(measured.deriveMs)} ms · mount ${round(measured.mountMs)} ms · ` +
          `${measured.spawns} entities · heap +${round(measured.heapMb)} MB`,
      );
      expect(measured.spawns).toBe(1_000);
      expect(measured.deriveMs + measured.mountMs).toBeLessThan(BUDGET_MS);
    },
    FIXTURE_TIMEOUT_MS,
  );

  it(
    "should plan 5 000 entities within the smoke budget",
    () => {
      const measured = mountCost(5_000, () =>
        Array.from({ length: 5_000 }, (_unused, index) => placement(index)),
      );
      console.info(
        `[ice-perf] 5000 placements (no document) · mount ${round(measured.mountMs)} ms · ` +
          `${measured.spawns} entities · heap +${round(measured.heapMb)} MB`,
      );
      expect(measured.spawns).toBe(5_000);
      expect(measured.mountMs).toBeLessThan(BUDGET_MS);
    },
    FIXTURE_TIMEOUT_MS,
  );
});
