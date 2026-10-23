import { WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import {
  applyCanonicalWrite,
  boardRectToWorld,
  boardToScreen,
  boardToWorld,
  buildInstanceIndex,
  type CanonicalWriter,
  capabilitiesForRole,
  composeInstanceTransforms,
  EMPTY_SELECTION,
  IceGestureSession as GestureSession,
  ICE_EDIT_CAPABILITIES,
  ICE_VIEW_CAPABILITIES,
  ICE_WRITE_ORIGIN,
  type IceCardInstance,
  type IceCommitOutcome,
  type IceCommitPlan,
  type IceInstanceTransform,
  type IcePlan,
  type IceSectionInstance,
  instancesOfCard,
  invertInstanceTransform,
  planCreate,
  planDelete,
  planEdgeCreate,
  planEdgeDelete,
  planIntent,
  planMoveCommit,
  planResizeCommit,
  planSectionMoveCommit,
  planSectionResizeCommit,
  planSelection,
  resolveInstance,
  runIceHistory,
  screenToBoard,
  workspaceWriter,
  worldDeltaToBoardDelta,
  worldRectToBoard,
} from "./iceBridge";

const IDENTITY: IceInstanceTransform = { scale: 1, x: 0, y: 0 };

function cardRef(input: {
  instanceKey: string;
  cardId: string;
  boardId?: string;
  path?: readonly string[];
  transform?: IceInstanceTransform;
  geometry?: { x: number; y: number; width: number; height: number };
}): IceCardInstance {
  return {
    kind: "card",
    instanceKey: input.instanceKey,
    cardId: input.cardId,
    boardId: input.boardId ?? "board-1",
    path: input.path ?? ["board-1"],
    transform: input.transform ?? IDENTITY,
    geometry: input.geometry ?? { x: 0, y: 0, width: 200, height: 120 },
  };
}

function sectionRef(input: {
  instanceKey: string;
  sectionId: string;
  boardId?: string;
  path?: readonly string[];
  transform?: IceInstanceTransform;
  geometry?: { x: number; y: number; width: number; height: number };
}): IceSectionInstance {
  return {
    kind: "section",
    instanceKey: input.instanceKey,
    sectionId: input.sectionId,
    boardId: input.boardId ?? "board-1",
    path: input.path ?? ["board-1"],
    transform: input.transform ?? IDENTITY,
    geometry: input.geometry ?? { x: 100, y: 100, width: 300, height: 200 },
  };
}

/** Every writer method is a spy, except `batch` which runs its body inline. */
function createWriter() {
  const batchOrigins: string[] = [];
  const writer = {
    movePlacements: vi.fn(),
    updatePlacementGeometry: vi.fn(),
    createCard: vi.fn(),
    trashCards: vi.fn(),
    moveSections: vi.fn(),
    updateSectionGeometry: vi.fn(),
    deleteSections: vi.fn(),
    addEdge: vi.fn(),
    removeEdges: vi.fn(),
    batch: <T>(origin: string, fn: () => T): T => {
      batchOrigins.push(origin);
      return fn();
    },
  } satisfies CanonicalWriter;
  return { writer, batchOrigins };
}

function expectCommit(plan: IcePlan): IceCommitPlan {
  if (plan.status !== "commit") {
    throw new Error(`expected a commit plan, got ${plan.status}: ${plan.reason}`);
  }
  return plan;
}

function expectCommitted(input: GestureSession | IceCommitOutcome) {
  const outcome = input instanceof GestureSession ? input.commit() : input;
  if (outcome.status !== "committed") {
    throw new Error(`expected a commit, got ${outcome.reason}`);
  }
  return outcome;
}

describe("iceBridge geometry", () => {
  it("should round-trip board and world coordinates for a scaled instance", () => {
    const transform: IceInstanceTransform = { scale: 2, x: 100, y: 50 };
    const world = boardToWorld(transform, { x: 3, y: 4 });
    expect(world).toEqual({ x: 106, y: 58 });

    const inverse = invertInstanceTransform(transform);
    expect(inverse).not.toBeNull();
    if (inverse) {
      expect(boardToWorld(inverse, world ?? { x: 0, y: 0 })).toEqual({ x: 3, y: 4 });
    }
  });

  it("should round-trip a rotated instance", () => {
    const transform: IceInstanceTransform = { scale: 2, x: 100, y: 50, rotation: Math.PI / 2 };
    expect(boardToWorld(transform, { x: 3, y: 4 })).toEqual({ x: 92, y: 56 });

    const inverse = invertInstanceTransform(transform);
    expect(inverse).not.toBeNull();
    if (inverse) {
      const back = boardToWorld(inverse, { x: 92, y: 56 });
      expect(back?.x).toBeCloseTo(3, 12);
      expect(back?.y).toBeCloseTo(4, 12);
    }
  });

  it("should round-trip screen and board coordinates through the camera", () => {
    const camera = { x: 40, y: -20, zoom: 2.5 };
    const screen = boardToScreen(camera, IDENTITY, { x: 3, y: 4 });
    expect(screen).toEqual({ x: 47.5, y: -10 });
    const back = screenToBoard(camera, IDENTITY, screen ?? { x: 0, y: 0 });
    expect(back?.x).toBeCloseTo(3, 12);
    expect(back?.y).toBeCloseTo(4, 12);
  });

  it("should compose nested instances, rotation included", () => {
    const outer: IceInstanceTransform = { scale: 2, x: 5, y: 7, rotation: Math.PI / 2 };
    const inner: IceInstanceTransform = { scale: 3, x: 1, y: 2 };
    const composed = composeInstanceTransforms(outer, inner);
    expect(composed.scale).toBe(6);
    expect(composed.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(composed.x).toBeCloseTo(1, 12);
    expect(composed.y).toBeCloseTo(9, 12);

    const point = { x: 2, y: 3 };
    const innerWorld = boardToWorld(inner, point);
    expect(innerWorld).not.toBeNull();
    const viaOuter = boardToWorld(outer, innerWorld ?? point);
    const viaComposed = boardToWorld(composed, point);
    expect(viaComposed?.x).toBeCloseTo(viaOuter?.x ?? Number.NaN, 12);
    expect(viaComposed?.y).toBeCloseTo(viaOuter?.y ?? Number.NaN, 12);
  });

  it("should map a world delta into board units for a rotated, scaled instance", () => {
    const transform: IceInstanceTransform = { scale: 2, x: 30, y: 40, rotation: Math.PI / 2 };
    const delta = worldDeltaToBoardDelta(transform, { x: 10, y: 0 });
    expect(delta?.x).toBeCloseTo(0, 12);
    expect(delta?.y).toBeCloseTo(-5, 12);
  });

  it("should map a snapped world rect back to board coordinates when rotated", () => {
    const transform: IceInstanceTransform = { scale: 2, x: 0, y: 0, rotation: Math.PI / 2 };
    const board = { x: 10, y: 20, width: 40, height: 20 };
    const world = boardRectToWorld(transform, board);
    expect(world?.x).toBeCloseTo(-80, 9);
    expect(world?.y).toBeCloseTo(20, 9);
    expect(world?.width).toBeCloseTo(40, 9);
    expect(world?.height).toBeCloseTo(80, 9);

    const back = worldRectToBoard(transform, world ?? board);
    expect(back?.x).toBeCloseTo(10, 12);
    expect(back?.y).toBeCloseTo(20, 12);
    expect(back?.width).toBeCloseTo(40, 12);
    expect(back?.height).toBeCloseTo(20, 12);
  });

  it("should refuse a degenerate transform instead of inventing coordinates", () => {
    const degenerate: IceInstanceTransform = { scale: 0, x: 10, y: 10 };
    expect(boardToWorld(degenerate, { x: 1, y: 1 })).toBeNull();
    expect(worldDeltaToBoardDelta(degenerate, { x: 1, y: 1 })).toBeNull();
    expect(worldRectToBoard(degenerate, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });
});

describe("iceBridge instances and selection", () => {
  const first = cardRef({ instanceKey: "i1", cardId: "card-a" });
  const second = cardRef({
    instanceKey: "i2",
    cardId: "card-a",
    path: ["board-1", "board-2"],
    transform: { scale: 0.5, x: 100, y: 50 },
    geometry: { x: 10, y: 10, width: 200, height: 120 },
  });
  const other = cardRef({ instanceKey: "i3", cardId: "card-b" });
  const index = buildInstanceIndex([first, second, other]);

  it("should resolve an instance by key and miss a stale entity", () => {
    expect(resolveInstance(index, "i2")).toBe(second);
    expect(resolveInstance(index, "gone")).toBeNull();
    expect(instancesOfCard(index, "card-a")).toHaveLength(2);
    expect(instancesOfCard(index, "nope")).toHaveLength(0);
  });

  it("should keep the first instance when a key repeats", () => {
    const duplicate = cardRef({ instanceKey: "i1", cardId: "card-z" });
    const deduped = buildInstanceIndex([first, duplicate]);
    expect(deduped.instances).toHaveLength(1);
    expect(resolveInstance(deduped, "i1")).toMatchObject({ cardId: "card-a" });
  });

  it("should select one canonical card across two instances and repaint both", () => {
    const plan = planSelection({ index, instanceKeys: ["i1", "i2"], mode: "replace" });
    expect(plan.selection.cardIds).toEqual(["card-a"]);
    expect(plan.selection.primaryCardId).toBe("card-a");
    expect(plan.instanceKeys).toEqual(["i1", "i2"]);
    expect(plan.changed).toBe(true);

    // Clicking the other instance selects the same canonical card and still
    // names both instances, because both paint it.
    const fromOther = planSelection({ index, instanceKeys: ["i2"], mode: "replace" });
    expect(fromOther.selection.cardIds).toEqual(["card-a"]);
    expect(fromOther.instanceKeys).toEqual(["i1", "i2"]);
  });

  it("should add, remove and toggle canonical ids without duplicating them", () => {
    const base = planSelection({ index, instanceKeys: ["i1"], mode: "replace" });
    const added = planSelection({
      index,
      instanceKeys: ["i2", "i3"],
      mode: "add",
      current: base.selection,
    });
    expect(added.selection.cardIds).toEqual(["card-a", "card-b"]);

    const removed = planSelection({
      index,
      instanceKeys: ["i2"],
      mode: "remove",
      current: added.selection,
    });
    expect(removed.selection.cardIds).toEqual(["card-b"]);

    const toggled = planSelection({
      index,
      instanceKeys: ["i1"],
      mode: "toggle",
      current: base.selection,
    });
    expect(toggled.selection.cardIds).toEqual([]);
    expect(toggled.selection.primaryCardId).toBeNull();
  });

  it("should report stale instance keys and leave the selection alone", () => {
    const plan = planSelection({
      index,
      instanceKeys: ["gone"],
      mode: "replace",
      current: EMPTY_SELECTION,
    });
    expect(plan.missingKeys).toEqual(["gone"]);
    expect(plan.selection.cardIds).toEqual([]);
    expect(plan.changed).toBe(false);
  });

  it("should keep sections in their own canonical bucket", () => {
    const sectionIndex = buildInstanceIndex([
      sectionRef({ instanceKey: "s1", sectionId: "section-a" }),
      sectionRef({
        instanceKey: "s2",
        sectionId: "section-a",
        transform: { scale: 2, x: 0, y: 0 },
      }),
    ]);
    const plan = planSelection({ index: sectionIndex, instanceKeys: ["s2"], mode: "replace" });
    expect(plan.selection.sectionIds).toEqual(["section-a"]);
    expect(plan.selection.cardIds).toEqual([]);
    expect(plan.selection.primarySectionId).toBe("section-a");
    expect(plan.instanceKeys).toEqual(["s1", "s2"]);
  });
});

describe("iceBridge move planning and gesture sessions", () => {
  const start = { x: 10, y: 10, width: 200, height: 120 };

  function moveIntent(
    worldDelta: { x: number; y: number },
    finalGeometry?: { x: number; y: number; width: number; height: number },
  ) {
    return {
      kind: "move" as const,
      items: [
        {
          instance: cardRef({ instanceKey: "i1", cardId: "card-a", geometry: start }),
          ...(finalGeometry ? { finalGeometry } : {}),
        },
      ],
      worldDelta,
    };
  }

  it("should map a world drag into one canonical placement move", () => {
    const { writer } = createWriter();
    const session = new GestureSession({
      writer,
      capabilities: ICE_EDIT_CAPABILITIES,
    });
    expect(session.begin({ kind: "move", items: moveIntent({ x: 0, y: 0 }).items })).toBe(true);

    session.update({ worldDelta: { x: 12, y: 8 } });
    session.update({ worldDelta: { x: 40, y: 30 } });
    expect(writer.movePlacements).not.toHaveBeenCalled();
    expect(session.live[0]?.geometry).toEqual({ x: 50, y: 40, width: 200, height: 120 });

    const outcome = expectCommitted(session);
    expect(outcome.plan.write).toEqual({
      kind: "movePlacements",
      boardId: "board-1",
      moves: [{ cardId: "card-a", x: 50, y: 40 }],
    });
    expect(writer.movePlacements).toHaveBeenCalledTimes(1);
    expect(writer.movePlacements).toHaveBeenCalledWith("board-1", [
      { cardId: "card-a", x: 50, y: 40 },
    ]);
    expect(session.status).toBe("committed");
    expect(session.live).toEqual([]);
  });

  it("should commit once per gesture even if the release repeats", () => {
    const { writer } = createWriter();
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    session.begin({ kind: "move", items: moveIntent({ x: 0, y: 0 }).items });
    session.update({ worldDelta: { x: 40, y: 30 } });

    expectCommitted(session);
    const second = session.commit();
    expect(second).toEqual({ status: "refused", reason: "already-finished" });
    expect(writer.movePlacements).toHaveBeenCalledTimes(1);
  });

  it("should write nothing when a drag is cancelled", () => {
    const { writer } = createWriter();
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    session.begin({ kind: "move", items: moveIntent({ x: 0, y: 0 }).items });
    session.update({ worldDelta: { x: 80, y: 60 } });
    session.cancel();

    expect(session.status).toBe("cancelled");
    expect(session.live).toEqual([]);
    expect(session.commit()).toEqual({ status: "refused", reason: "already-finished" });
    expect(writer.movePlacements).not.toHaveBeenCalled();
  });

  it("should write nothing for a sub-epsilon move", () => {
    const { writer } = createWriter();
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    session.begin({ kind: "move", items: moveIntent({ x: 0, y: 0 }).items });
    session.update({ worldDelta: { x: 0.2, y: -0.1 } });

    expect(session.commit()).toEqual({ status: "refused", reason: "sub-epsilon" });
    expect(writer.movePlacements).not.toHaveBeenCalled();

    const direct = planMoveCommit(moveIntent({ x: 0.2, y: -0.1 }), {
      capabilities: ICE_EDIT_CAPABILITIES,
    });
    expect(direct).toEqual({ status: "skip", reason: "sub-epsilon" });
  });

  it("should commit the snapped rect ICE resolved, not the raw pointer delta", () => {
    const { writer } = createWriter();
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    session.begin({ kind: "move", items: moveIntent({ x: 0, y: 0 }).items });

    // The pointer only travelled 13/7, but ICE's snap guide pulled the card.
    session.update({ worldDelta: { x: 13, y: 7 } });
    expect(session.live[0]?.geometry).toEqual({ x: 23, y: 17, width: 200, height: 120 });

    const outcome = expectCommitted(
      session.commit({
        finalGeometry: [{ instanceKey: "i1", rect: { x: 48, y: 32, width: 200, height: 120 } }],
      }),
    );
    expect(outcome.plan.write).toEqual({
      kind: "movePlacements",
      boardId: "board-1",
      moves: [{ cardId: "card-a", x: 48, y: 32 }],
    });
    expect(writer.movePlacements).toHaveBeenCalledTimes(1);
  });

  it("should write nothing when a snap settles back on the start position", () => {
    const { writer } = createWriter();
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    session.begin({ kind: "move", items: moveIntent({ x: 0, y: 0 }).items });
    session.update({ worldDelta: { x: 2, y: 2 } });

    const outcome = session.commit({
      finalGeometry: [{ instanceKey: "i1", rect: { x: 10, y: 10, width: 200, height: 120 } }],
    });
    expect(outcome).toEqual({ status: "refused", reason: "no-change" });
    expect(writer.movePlacements).not.toHaveBeenCalled();
  });

  it("should write nothing for a viewer", () => {
    const { writer } = createWriter();
    const session = new GestureSession({
      writer,
      capabilities: capabilitiesForRole("viewer"),
    });
    session.begin({ kind: "move", items: moveIntent({ x: 0, y: 0 }).items });
    session.update({ worldDelta: { x: 60, y: 40 } });
    expect(session.commit()).toEqual({ status: "refused", reason: "read-only" });
    expect(writer.movePlacements).not.toHaveBeenCalled();

    const plan = planMoveCommit(moveIntent({ x: 60, y: 40 }), {
      capabilities: ICE_VIEW_CAPABILITIES,
    });
    expect(plan).toEqual({ status: "denied", reason: "read-only" });
  });

  it("should write one canonical placement when two instances paint one card", () => {
    const { writer } = createWriter();
    const index = buildInstanceIndex([
      cardRef({ instanceKey: "i1", cardId: "card-a", geometry: start }),
      cardRef({
        instanceKey: "i2",
        cardId: "card-a",
        path: ["board-1", "board-2"],
        transform: { scale: 0.5, x: 100, y: 50 },
        geometry: start,
      }),
    ]);
    const selected = planSelection({ index, instanceKeys: ["i1", "i2"], mode: "replace" });
    expect(selected.selection.cardIds).toEqual(["card-a"]);

    const items = selected.selection.cardIds.map((cardId) => {
      const instance = instancesOfCard(index, cardId)[0];
      return { instance: instance ?? cardRef({ instanceKey: "missing", cardId }) };
    });
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    expect(session.begin({ kind: "move", items })).toBe(true);
    session.update({ worldDelta: { x: 10, y: 10 } });
    expectCommitted(session);

    expect(writer.movePlacements).toHaveBeenCalledTimes(1);
    expect(writer.movePlacements).toHaveBeenCalledWith("board-1", [
      { cardId: "card-a", x: 20, y: 20 },
    ]);
  });

  it("should map a drag inside a nested, scaled instance into board units", () => {
    const { writer } = createWriter();
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    const item = {
      instance: cardRef({
        instanceKey: "nested",
        cardId: "card-a",
        path: ["board-1", "board-2"],
        transform: { scale: 0.5, x: 100, y: 50 },
        geometry: start,
      }),
    };
    session.begin({ kind: "move", items: [item] });
    session.update({ worldDelta: { x: 10, y: 10 } });
    expect(session.live[0]?.geometry).toEqual({ x: 30, y: 30, width: 200, height: 120 });
    expectCommitted(session);
    expect(writer.movePlacements).toHaveBeenCalledWith("board-1", [
      { cardId: "card-a", x: 30, y: 30 },
    ]);
  });

  it("should drop a drag that spans two boards instead of writing twice", () => {
    const plan = planMoveCommit(
      {
        kind: "move",
        items: [
          { instance: cardRef({ instanceKey: "i1", cardId: "card-a", boardId: "board-1" }) },
          { instance: cardRef({ instanceKey: "i2", cardId: "card-b", boardId: "board-2" }) },
        ],
        worldDelta: { x: 40, y: 40 },
      },
      { capabilities: ICE_EDIT_CAPABILITIES },
    );
    expect(plan).toEqual({ status: "skip", reason: "mixed-boards" });
  });

  it("should refuse to start when no instance resolved", () => {
    const { writer } = createWriter();
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    expect(session.begin({ kind: "move", items: [] })).toBe(false);
    expect(session.commit()).toEqual({ status: "refused", reason: "not-active" });
    expect(writer.movePlacements).not.toHaveBeenCalled();
  });

  it("should write nothing when no writer is installed", () => {
    const session = new GestureSession({ writer: null, capabilities: ICE_EDIT_CAPABILITIES });
    session.begin({ kind: "move", items: moveIntent({ x: 0, y: 0 }).items });
    session.update({ worldDelta: { x: 40, y: 30 } });
    expect(session.commit()).toEqual({ status: "refused", reason: "missing-writer" });
  });
});

describe("iceBridge resize planning", () => {
  const start = { x: 0, y: 0, width: 200, height: 100 };

  function resizeIntent(
    handle: "se" | "nw" | "e",
    finalGeometry?: {
      x: number;
      y: number;
      width: number;
      height: number;
    },
  ) {
    return {
      kind: "resize" as const,
      item: {
        instance: cardRef({ instanceKey: "i1", cardId: "card-a", geometry: start }),
        ...(finalGeometry ? { finalGeometry } : {}),
      },
      handle,
      worldDelta: { x: 0, y: 0 },
    };
  }

  it("should resize from the handle with the opposite edge anchored", () => {
    const plan = expectCommit(
      planResizeCommit(
        { ...resizeIntent("se"), worldDelta: { x: 50, y: 25 } },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(plan.write).toEqual({
      kind: "resizePlacement",
      boardId: "board-1",
      cardId: "card-a",
      geometry: { x: 0, y: 0, width: 250, height: 125 },
    });

    const fromCorner = expectCommit(
      planResizeCommit(
        { ...resizeIntent("nw"), worldDelta: { x: 40, y: 20 } },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(fromCorner.write).toEqual({
      kind: "resizePlacement",
      boardId: "board-1",
      cardId: "card-a",
      geometry: { x: 40, y: 20, width: 160, height: 80 },
    });
  });

  it("should clamp a resize to the minimum size", () => {
    const plan = expectCommit(
      planResizeCommit(
        { ...resizeIntent("se"), worldDelta: { x: -500, y: -500 } },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(plan.write).toMatchObject({
      geometry: { x: 0, y: 0, width: 48, height: 32 },
    });
  });

  it("should commit the snapped resize rect once", () => {
    const { writer } = createWriter();
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    session.begin({
      kind: "resize",
      items: [
        {
          instance: cardRef({ instanceKey: "i1", cardId: "card-a", geometry: start }),
        },
      ],
      handle: "se",
    });
    session.update({ worldDelta: { x: 47, y: 21 } });
    expectCommitted(
      session.commit({
        finalGeometry: [{ instanceKey: "i1", rect: { x: 0, y: 0, width: 300, height: 150 } }],
      }),
    );
    expect(writer.updatePlacementGeometry).toHaveBeenCalledTimes(1);
    expect(writer.updatePlacementGeometry).toHaveBeenCalledWith("board-1", "card-a", {
      x: 0,
      y: 0,
      width: 300,
      height: 150,
    });
  });

  it("should refuse a resize with no change and for a viewer", () => {
    expect(planResizeCommit(resizeIntent("se"), { capabilities: ICE_EDIT_CAPABILITIES })).toEqual({
      status: "skip",
      reason: "sub-epsilon",
    });
    expect(
      planResizeCommit(
        { ...resizeIntent("se"), worldDelta: { x: 40, y: 40 } },
        { capabilities: ICE_VIEW_CAPABILITIES },
      ),
    ).toEqual({ status: "denied", reason: "read-only" });
  });

  it("should scale the resize delta by the instance transform", () => {
    const plan = expectCommit(
      planResizeCommit(
        {
          kind: "resize",
          item: {
            instance: cardRef({
              instanceKey: "nested",
              cardId: "card-a",
              transform: { scale: 0.5, x: 100, y: 50 },
              geometry: start,
            }),
          },
          handle: "e",
          worldDelta: { x: 50, y: 0 },
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(plan.write).toMatchObject({ geometry: { width: 300 } });
  });
});

describe("iceBridge sections", () => {
  it("should move a section and its members in one write", () => {
    const plan = expectCommit(
      planSectionMoveCommit(
        {
          kind: "section-move",
          items: [
            {
              instance: sectionRef({
                instanceKey: "s1",
                sectionId: "section-a",
                geometry: { x: 100, y: 100, width: 300, height: 200 },
              }),
            },
          ],
          worldDelta: { x: 10, y: 5 },
          members: [
            {
              cardId: "card-a",
              startGeometry: { x: 120, y: 130, width: 100, height: 60 },
            },
          ],
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(plan.write).toEqual({
      kind: "moveSections",
      input: {
        sections: [{ id: "section-a", x: 110, y: 105 }],
        placements: [{ boardId: "board-1", cardId: "card-a", x: 130, y: 135 }],
      },
    });
  });

  it("should resize a section with the section floor", () => {
    const plan = expectCommit(
      planSectionResizeCommit(
        {
          kind: "section-resize",
          item: {
            instance: sectionRef({
              instanceKey: "s1",
              sectionId: "section-a",
              geometry: { x: 100, y: 100, width: 300, height: 200 },
            }),
          },
          handle: "e",
          worldDelta: { x: 20, y: 0 },
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(plan.write).toEqual({
      kind: "resizeSection",
      sectionId: "section-a",
      geometry: { x: 100, y: 100, width: 320, height: 200 },
    });

    const floored = expectCommit(
      planSectionResizeCommit(
        {
          kind: "section-resize",
          item: {
            instance: sectionRef({ instanceKey: "s1", sectionId: "section-a" }),
            finalGeometry: { x: 100, y: 100, width: 10, height: 10 },
          },
          handle: "se",
          worldDelta: { x: 0, y: 0 },
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(floored.write).toMatchObject({ geometry: { width: 80, height: 60 } });
  });

  it("should refuse a section planner when the instance is a card", () => {
    const plan = planSectionResizeCommit(
      {
        kind: "section-resize",
        item: { instance: cardRef({ instanceKey: "i1", cardId: "card-a" }) },
        handle: "e",
        worldDelta: { x: 20, y: 0 },
      },
      { capabilities: ICE_EDIT_CAPABILITIES },
    );
    expect(plan).toEqual({ status: "skip", reason: "wrong-instance" });
  });
});

describe("iceBridge create, delete and edges", () => {
  it("should create on the board the pointer landed in", () => {
    const flat = expectCommit(
      planCreate(
        {
          kind: "create",
          instance: cardRef({ instanceKey: "i1", cardId: "existing" }),
          cardId: "card-new",
          typeId: "note",
          world: { x: 120, y: 80 },
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(flat.write).toEqual({
      kind: "createCard",
      input: {
        boardId: "board-1",
        cardId: "card-new",
        typeId: "note",
        position: { x: 120, y: 80 },
      },
    });

    const nested = expectCommit(
      planCreate(
        {
          kind: "create",
          instance: cardRef({
            instanceKey: "nested",
            cardId: "existing",
            transform: { scale: 0.5, x: 100, y: 50 },
          }),
          world: { x: 120, y: 80 },
          size: { width: 288, height: 240 },
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(nested.write).toMatchObject({
      input: { position: { x: 40, y: 60 }, size: { width: 288, height: 240 } },
    });
  });

  it("should create at the snapped rect when ICE reports one", () => {
    const plan = expectCommit(
      planCreate(
        {
          kind: "create",
          instance: cardRef({ instanceKey: "i1", cardId: "existing" }),
          world: { x: 120, y: 80 },
          finalGeometry: { x: 144, y: 96, width: 200, height: 120 },
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(plan.write).toMatchObject({ input: { position: { x: 144, y: 96 } } });
  });

  it("should refuse a create with no board and for a viewer", () => {
    expect(
      planCreate(
        { kind: "create", world: { x: 10, y: 10 } },
        {
          capabilities: ICE_EDIT_CAPABILITIES,
        },
      ),
    ).toEqual({ status: "skip", reason: "no-instance" });

    expect(
      planCreate(
        {
          kind: "create",
          instance: cardRef({ instanceKey: "i1", cardId: "card-a" }),
          world: { x: 1, y: 1 },
        },
        { capabilities: ICE_VIEW_CAPABILITIES },
      ),
    ).toEqual({ status: "denied", reason: "read-only" });
  });

  it("should delete a selection as one write with canonical ids deduped", () => {
    const { writer, batchOrigins } = createWriter();
    const plan = expectCommit(
      planDelete(
        {
          kind: "delete",
          selection: {
            cardIds: ["card-a", "card-a", "card-b"],
            sectionIds: ["section-a"],
            primaryCardId: "card-a",
            primarySectionId: null,
          },
          edgeIds: ["edge-1", "edge-1"],
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(plan.write).toEqual({
      kind: "delete",
      cardIds: ["card-a", "card-b"],
      sectionIds: ["section-a"],
      edgeIds: ["edge-1"],
    });

    applyCanonicalWrite(writer, plan.write);
    expect(writer.trashCards).toHaveBeenCalledTimes(1);
    expect(writer.trashCards).toHaveBeenCalledWith(["card-a", "card-b"]);
    expect(writer.deleteSections).toHaveBeenCalledWith(["section-a"]);
    expect(writer.removeEdges).toHaveBeenCalledWith(["edge-1"]);
    expect(batchOrigins).toEqual([`${ICE_WRITE_ORIGIN}:delete`]);
  });

  it("should refuse an empty delete and a viewer delete", () => {
    expect(
      planDelete(
        { kind: "delete", selection: EMPTY_SELECTION },
        {
          capabilities: ICE_EDIT_CAPABILITIES,
        },
      ),
    ).toEqual({ status: "skip", reason: "empty-selection" });

    expect(
      planDelete(
        {
          kind: "delete",
          selection: { ...EMPTY_SELECTION, cardIds: ["card-a"] },
        },
        { capabilities: ICE_VIEW_CAPABILITIES },
      ),
    ).toEqual({ status: "denied", reason: "read-only" });
  });

  it("should plan an edge between two connectors and refuse a self-loop", () => {
    const plan = expectCommit(
      planEdgeCreate(
        {
          kind: "edge-create",
          boardId: "board-1",
          source: { cardId: "card-a", connectorId: "east" },
          target: { cardId: "card-b", connectorId: "west" },
          edgeKind: "references",
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    expect(plan.write).toEqual({
      kind: "addEdge",
      input: {
        boardId: "board-1",
        source: "card-a",
        target: "card-b",
        sourceConnector: "east",
        targetConnector: "west",
        kind: "references",
      },
    });

    expect(
      planEdgeCreate(
        {
          kind: "edge-create",
          boardId: "board-1",
          source: { cardId: "card-a" },
          target: { cardId: "card-a" },
        },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    ).toEqual({ status: "skip", reason: "same-card" });
  });

  it("should plan edge deletion and dispatch every intent kind", () => {
    const { writer } = createWriter();
    const plan = expectCommit(
      planEdgeDelete(
        { kind: "edge-delete", edgeIds: ["edge-1", "edge-1", "edge-2"] },
        { capabilities: ICE_EDIT_CAPABILITIES },
      ),
    );
    applyCanonicalWrite(writer, plan.write);
    expect(writer.removeEdges).toHaveBeenCalledWith(["edge-1", "edge-2"]);

    const dispatched = planIntent(
      { kind: "edge-delete", edgeIds: ["edge-3"] },
      { capabilities: ICE_EDIT_CAPABILITIES },
    );
    expect(dispatched.status).toBe("commit");

    expect(
      planIntent({ kind: "edge-delete", edgeIds: [] }, { capabilities: ICE_EDIT_CAPABILITIES }),
    ).toEqual({ status: "skip", reason: "empty-selection" });
  });
});

describe("iceBridge workspace adapter", () => {
  function createDoc() {
    const doc = new WorkspaceDocument(new LoroDoc());
    doc.createBoard({ id: "board-1", name: "Board" });
    doc.createCard({ id: "card-a", boardId: "board-1", position: { x: 10, y: 10 } });
    return doc;
  }

  it("should commit a drag as one undo step", () => {
    const doc = createDoc();
    const writer = workspaceWriter(doc);
    const session = new GestureSession({ writer, capabilities: ICE_EDIT_CAPABILITIES });
    session.begin({
      kind: "move",
      items: [
        {
          instance: cardRef({
            instanceKey: "i1",
            cardId: "card-a",
            geometry: { x: 10, y: 10, width: 200, height: 120 },
          }),
        },
      ],
    });
    session.update({ worldDelta: { x: 30, y: 20 } });
    session.update({ worldDelta: { x: 90, y: 60 } });
    expectCommitted(session);

    expect(doc.getPlacement("board-1", "card-a")).toMatchObject({ x: 100, y: 70 });
    expect(runIceHistory(doc, "undo")).toBe(true);
    expect(doc.getPlacement("board-1", "card-a")).toMatchObject({ x: 10, y: 10 });
  });

  it("should batch a multi-card delete into one undo step", () => {
    const doc = createDoc();
    doc.createCard({ id: "card-b", boardId: "board-1", position: { x: 300, y: 10 } });
    const writer = workspaceWriter(doc);

    applyCanonicalWrite(writer, {
      kind: "delete",
      cardIds: ["card-a", "card-b"],
      sectionIds: [],
      edgeIds: [],
    });
    expect(doc.isTrashed("card-a")).toBe(true);
    expect(doc.isTrashed("card-b")).toBe(true);

    expect(runIceHistory(doc, "undo")).toBe(true);
    expect(doc.isTrashed("card-a")).toBe(false);
    expect(doc.isTrashed("card-b")).toBe(false);
  });

  it("should create a card and its size in one undo step", () => {
    const doc = createDoc();
    const writer = workspaceWriter(doc);

    applyCanonicalWrite(writer, {
      kind: "createCard",
      input: {
        boardId: "board-1",
        cardId: "card-new",
        position: { x: 5, y: 6 },
        size: { width: 300, height: 200 },
      },
    });
    expect(doc.getPlacement("board-1", "card-new")).toMatchObject({
      x: 5,
      y: 6,
      width: 300,
      height: 200,
    });

    expect(runIceHistory(doc, "undo")).toBe(true);
    expect(doc.getCard("card-new")).toBeUndefined();
  });

  it("should move a section and its members through the real document", () => {
    const doc = createDoc();
    const section = doc.createSection({
      id: "section-a",
      boardId: "board-1",
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    });
    expect(section.id).toBe("section-a");
    const writer = workspaceWriter(doc);

    applyCanonicalWrite(writer, {
      kind: "moveSections",
      input: {
        sections: [{ id: "section-a", x: 150, y: 120 }],
        placements: [{ boardId: "board-1", cardId: "card-a", x: 60, y: 40 }],
      },
    });
    expect(doc.getSection("section-a")).toMatchObject({ x: 150, y: 120 });
    expect(doc.getPlacement("board-1", "card-a")).toMatchObject({ x: 60, y: 40 });

    expect(runIceHistory(doc, "undo")).toBe(true);
    expect(doc.getSection("section-a")).toMatchObject({ x: 100, y: 100 });
    expect(doc.getPlacement("board-1", "card-a")).toMatchObject({ x: 10, y: 10 });
  });

  it("should report a viewer session as select-only", () => {
    expect(capabilitiesForRole("owner")).toEqual(ICE_EDIT_CAPABILITIES);
    expect(capabilitiesForRole("editor")).toEqual(ICE_EDIT_CAPABILITIES);
    expect(capabilitiesForRole("viewer")).toEqual(ICE_VIEW_CAPABILITIES);
    expect(capabilitiesForRole("viewer").select).toBe(true);
    expect(capabilitiesForRole("viewer").write).toBe(false);
  });
});
