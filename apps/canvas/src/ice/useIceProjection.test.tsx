import { type Board, type Card, type View, WorkspaceDocument } from "@suite/graph";
import { act, renderHook } from "@testing-library/react";
import type { CanvasEngine, Entity } from "@vibecook/ice";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/multiSelect";
import { mergeSnapshots, type WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { useUiStore } from "../store/useUiStore";
import { workspaceStructureKey } from "./iceBoardTree";
import { applyCanonicalWrite, planDropCommit, workspaceWriter } from "./iceBridge";
import type { SeedReport } from "./iceSurfaceSpawns";
import { seedWorkspaceDocument } from "./iceSurfaceSpawns";
import type { IceOwned, IceWiring } from "./iceSurfaceWiring";
import { useIceProjection } from "./useIceProjection";

/**
 * The projection's lifecycle against a real document: what the desk draws after
 * a rebuild, what it keeps, and — the point of the structural key — which
 * document changes are allowed to reach the rebuild at all.
 *
 * ICE is stood in for by a desk that records what was spawned and where, which
 * is enough for the two facts under test: a card's parent frame and its box.
 */
vi.mock("@vibecook/ice", () => ({ currentNavFrame: () => undefined }));
vi.mock("./suiteBoardKind", () => ({
  suiteBoardSpawn: (input: {
    boardId: string;
    name: string;
    depth: number;
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => ({
    type: "suite.board",
    x: input.x,
    y: input.y,
    w: input.width,
    h: input.height,
    props: { boardId: input.boardId, name: input.name, depth: input.depth, color: input.color },
  }),
}));
vi.mock("./suiteEdgeKind", () => ({
  SUITE_EDGE_TYPE: "suite.edge",
  setSuiteEdgeLinkOf: () => undefined,
  suiteEdgeSpawn: () => ({ type: "suite.edge", x: 0, y: 0, w: 1, h: 1, props: {} }),
}));

const POSITION = { component: "Position" };
const SIZE = { component: "Size" };
const BOARD_ROOT = { resource: "BoardRoot" };
const CAMERA = { resource: "Camera" };

interface SpawnRecord {
  readonly entity: Entity;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly parent: Entity | undefined;
  readonly props: Record<string, unknown>;
}

/** A desk that keeps each entity's box and parent, and records every spawn. */
function fakeDesk() {
  const boxes = new Map<Entity, { x: number; y: number; w: number; h: number }>();
  const spawned: SpawnRecord[] = [];
  const root = 1 as unknown as Entity;
  let next = 1;
  let selected: Entity[] = [];

  const spawnWidget = vi.fn((type: string, opts: Record<string, unknown>) => {
    next += 1;
    const entity = next as unknown as Entity;
    boxes.set(entity, {
      x: Number(opts.x),
      y: Number(opts.y),
      w: typeof opts.w === "number" ? opts.w : DEFAULT_CARD_WIDTH,
      h: typeof opts.h === "number" ? opts.h : DEFAULT_CARD_HEIGHT,
    });
    spawned.push({
      entity,
      type,
      x: Number(opts.x),
      y: Number(opts.y),
      parent: opts.parent as Entity | undefined,
      props: (opts.props ?? {}) as Record<string, unknown>,
    });
    return entity;
  });
  const setSelection = vi.fn((entities: readonly Entity[]) => {
    selected = [...entities];
  });
  const deleteSelection = vi.fn(() => {
    for (const entity of selected) boxes.delete(entity);
    selected = [];
  });

  const world = {
    has: (entity: Entity) => boxes.has(entity),
    read: (entity: Entity, component: unknown) => {
      const box = boxes.get(entity);
      if (box === undefined) return undefined;
      return component === POSITION ? { x: box.x, y: box.y } : { x: 0, y: 0, w: box.w, h: box.h };
    },
    getResource: (resource: unknown) => (resource === BOARD_ROOT ? { root } : undefined),
  };

  const core = {
    Position: POSITION,
    Size: SIZE,
    BoardRoot: BOARD_ROOT,
    Camera: CAMERA,
    writeRuntimeResource: vi.fn(),
  };
  const engine = {
    ops: { spawnWidget, setSelection, deleteSelection },
    world,
    step: vi.fn(),
    nav: { depth: () => 0 },
  };

  return {
    engine: engine as unknown as CanvasEngine,
    core: core as unknown as typeof import("@vibecook/ice"),
    ops: { spawnWidget, setSelection, deleteSelection },
    root,
    spawned,
    boxes,
  };
}

function design() {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const view = doc.ensureView();
  const board = doc.createBoard({
    name: "Target",
    parentBoardId: view.id,
    x: 500,
    y: 400,
    width: 400,
    height: 300,
  });
  const card = doc.createCard({ boardId: view.id, position: { x: 40, y: 50 } });
  const anchor = doc.createCard({ boardId: view.id, position: { x: 400, y: 50 } });
  return { doc, view, board, card, anchor };
}

/** What the surface hands the projection: the store's merged view of the document. */
function snapshotOf(doc: WorkspaceDocument, previous?: WorkspaceSnapshot): WorkspaceSnapshot {
  const next: WorkspaceSnapshot = {
    boards: doc.listBoards(),
    views: doc.listViews(),
    cards: doc.listCards(),
    placements: doc.listPlacements(),
    edges: doc.listEdges(),
    types: [],
    tags: [],
    sections: [],
    references: {},
  };
  return previous === undefined ? next : mergeSnapshots(previous, next);
}

function harness(subject: {
  doc: WorkspaceDocument;
  view: View;
  board: Board;
  card: Card;
  anchor: Card;
}) {
  const desk = fakeDesk();
  const seed = seedWorkspaceDocument(desk.engine, subject.doc, subject.view.id);
  const owned: { current: IceOwned } = {
    current: { structure: workspaceStructureKey(subject.doc, subject.view.id), reseed: vi.fn() },
  };
  const commands = { current: null } as unknown as Parameters<
    typeof useIceProjection
  >[0]["commands"];

  const wiringOf = (current: SeedReport): IceWiring =>
    ({
      phase: { kind: "ready", engine: desk.engine, core: desk.core },
      seed: current,
      layerReady: 1,
      workspaceMode: true,
      liveWorkspace: subject.doc,
      rootBoardId: subject.view.id,
      caps: {},
      cameraApi: null,
      flyTo: () => undefined,
    }) as unknown as IceWiring;

  const initialSnapshot = snapshotOf(subject.doc);
  const view = renderHook(
    (props: { wiring: IceWiring; snapshot: WorkspaceSnapshot }) =>
      useIceProjection({
        wiring: props.wiring,
        snapshot: props.snapshot,
        commands,
        owned,
      }),
    { initialProps: { wiring: wiringOf(seed), snapshot: initialSnapshot } },
  );
  commands.current = { reconcile: view.result.current.reconcile } as never;
  return {
    ...desk,
    ...view,
    owned,
    seed,
    wiringOf,
    rerender: view.rerender,
  };
}

/** The mat a Board is drawn as, and the card entity standing for a card. */
function matOf(seed: SeedReport, boardId: string): Entity {
  for (const [entity, mat] of seed.boardMats) if (mat.boardId === boardId) return entity;
  throw new Error(`no mat for ${boardId}`);
}

function cardEntity(seed: SeedReport, cardId: string): Entity {
  for (const [entity, slot] of seed.entitySlots) if (slot.cardId === cardId) return entity;
  throw new Error(`no entity for ${cardId}`);
}

describe("useIceProjection", () => {
  it("should keep a card drawn on the mat it was dropped into", () => {
    const subject = design();
    const desk = harness(subject);
    const before = cardEntity(desk.seed, subject.card.id);
    const rootSpawn = desk.spawned.find((entry) => entry.entity === before);

    // The seed leaves a plane card on the root frame (no parent means the frame
    // the desk starts on); what matters here is which place it belongs to.
    expect(rootSpawn?.parent).toBeUndefined();
    expect(rootSpawn?.props.boardId).toBe(subject.view.id);

    // The drop: ICE re-parented the entity, so the write is the one the gesture
    // plans — the placement moves to the Board, in the Board's own frame.
    const plan = planDropCommit(
      {
        targetBoardId: subject.board.id,
        items: [
          {
            instance: { kind: "card", cardId: subject.card.id, boardId: subject.view.id } as never,
            geometry: { x: 30, y: 40, width: DEFAULT_CARD_WIDTH, height: DEFAULT_CARD_HEIGHT },
          },
        ],
      },
      { capabilities: { select: true, write: true } },
    );
    if (plan.status !== "commit") throw new Error("the drop should have been a write");
    applyCanonicalWrite(workspaceWriter(subject.doc), plan.write);

    act(() => desk.result.current.reconcile());

    const after = cardEntity(desk.seed, subject.card.id);
    const dropSpawn = desk.spawned.find((entry) => entry.entity === after);
    expect(dropSpawn?.parent).toBe(matOf(desk.seed, subject.board.id));
    expect(dropSpawn?.props.boardId).toBe(subject.board.id);
    // Frame-local, because the mat is the frame ICE measures the card in.
    expect({ x: dropSpawn?.x, y: dropSpawn?.y }).toEqual({ x: 30, y: 40 });

    // A second pass finds nothing to do: the derived coordinates and the box
    // ICE holds agree, so a dropped card does not churn on every reconcile.
    const spawns = desk.ops.spawnWidget.mock.calls.length;
    act(() => desk.result.current.reconcile());
    expect(desk.ops.spawnWidget.mock.calls.length).toBe(spawns);
  });

  it("should ask for one rebuild when a Board is created, and none for a card edit", () => {
    const subject = design();
    const desk = harness(subject);
    const reseed = desk.owned.current.reseed as ReturnType<typeof vi.fn>;
    let snapshot = snapshotOf(subject.doc);

    // A card move: the boards and views are untouched, so the effect that
    // compares the Board tree does not even run.
    subject.doc.updatePlacementPosition(subject.view.id, subject.card.id, { x: 90, y: 120 });
    snapshot = snapshotOf(subject.doc, snapshot);
    act(() => desk.rerender({ wiring: desk.wiringOf(desk.seed), snapshot }));
    expect(reseed).not.toHaveBeenCalled();

    // A card resize, a text edit and a link edit are the same class of change:
    // the snapshot's cards, placements or edges moved, the Boards did not.
    subject.doc.updatePlacementSize(subject.view.id, subject.card.id, {
      width: 320,
      height: 260,
    });
    subject.doc.addEdge({
      boardId: subject.view.id,
      source: subject.card.id,
      target: subject.anchor.id,
    });
    snapshot = snapshotOf(subject.doc, snapshot);
    act(() => desk.rerender({ wiring: desk.wiringOf(desk.seed), snapshot }));
    expect(reseed).not.toHaveBeenCalled();

    // A Board — one structural change, one rebuild.
    subject.doc.createBoard({
      name: "New",
      parentBoardId: subject.view.id,
      x: 1000,
      y: 400,
      width: 200,
      height: 200,
    });
    snapshot = snapshotOf(subject.doc, snapshot);
    act(() => desk.rerender({ wiring: desk.wiringOf(desk.seed), snapshot }));
    expect(reseed).toHaveBeenCalledTimes(1);

    // The rebuild records the tree it seeded from (`stageSeed`); the same
    // snapshot arriving again is not a second change.
    desk.owned.current.structure = workspaceStructureKey(subject.doc, subject.view.id);
    act(() => desk.rerender({ wiring: desk.wiringOf(desk.seed), snapshot }));
    expect(reseed).toHaveBeenCalledTimes(1);

    // A rename is structural too, and finds the key moved again.
    const renamed = subject.doc.listBoards().find((board) => board.name === "New");
    if (renamed === undefined) throw new Error("the new Board should be in the tree");
    subject.doc.renameBoard(renamed.id, "Renamed");
    snapshot = snapshotOf(subject.doc, snapshot);
    act(() => desk.rerender({ wiring: desk.wiringOf(desk.seed), snapshot }));
    expect(reseed).toHaveBeenCalledTimes(2);
  });

  it("should re-apply the shell's selection to the rebuilt entities", () => {
    const subject = design();
    const desk = harness(subject);
    useUiStore.getState().setSelectedNodeIds([subject.card.id]);

    // A rebuild replaces every entity, so the projection is handed the seed the
    // boot made next; the selection is a card id, and that id still exists.
    const rebuilt = seedWorkspaceDocument(desk.engine, subject.doc, subject.view.id);
    act(() =>
      desk.rerender({
        wiring: desk.wiringOf(rebuilt),
        snapshot: snapshotOf(subject.doc),
      }),
    );

    const entity = cardEntity(rebuilt, subject.card.id);
    const calls = desk.ops.setSelection.mock.calls;
    expect(calls.at(-1)).toEqual([[entity]]);
    useUiStore.getState().setSelectedNodeIds([]);
  });
});
