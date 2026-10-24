import { describe, expect, it, vi } from "vitest";
import {
  applyCanonicalWrite,
  buildInstanceIndex,
  type CanonicalWriter,
  ICE_EDIT_CAPABILITIES,
  ICE_VIEW_CAPABILITIES,
  type IceCapabilities,
  type IceCardInstance,
  type IceInstanceTransform,
  type IceSectionInstance,
  type IceSelection,
  type IceUndoAdapter,
} from "./iceBridge";
import {
  beginGesture,
  endGesture,
  type HistoryKeyLike,
  hasEditableFocus,
  ICE_EDITOR_ATTRIBUTE,
  ICE_NATIVE_HISTORY_ENABLED,
  ICE_POINTER_THRESHOLD,
  type IceGestureHandle,
  planDeleteGesture,
  resolvePick,
  routeIceHistory,
  updateGesture,
} from "./iceInteraction";
import { MAX_CARD_TYPE_SCALE, MIN_CARD_TYPE_SCALE, scaleForExtent } from "./suiteCardScale";

const IDENTITY: IceInstanceTransform = { scale: 1, x: 0, y: 0 };
const CAMERA = { x: 0, y: 0, zoom: 1 };
const START = { x: 10, y: 10, width: 200, height: 120 };

function card(input: {
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
    geometry: input.geometry ?? START,
  };
}

function section(input: {
  instanceKey: string;
  sectionId: string;
  boardId?: string;
  transform?: IceInstanceTransform;
  geometry?: { x: number; y: number; width: number; height: number };
}): IceSectionInstance {
  return {
    kind: "section",
    instanceKey: input.instanceKey,
    sectionId: input.sectionId,
    boardId: input.boardId ?? "board-1",
    path: ["board-1"],
    transform: input.transform ?? IDENTITY,
    geometry: input.geometry ?? { x: 100, y: 100, width: 300, height: 200 },
  };
}

function createWriter() {
  const writer = {
    movePlacements: vi.fn(),
    updatePlacementGeometry: vi.fn(),
    createCard: vi.fn(),
    trashCards: vi.fn(),
    moveSections: vi.fn(),
    updateSectionGeometry: vi.fn(),
    updateBoardRect: vi.fn(),
    deleteSections: vi.fn(),
    addEdge: vi.fn(),
    removeEdges: vi.fn(),
    batch: <T>(_origin: string, fn: () => T): T => fn(),
  } satisfies CanonicalWriter;
  return writer;
}

function press(input: {
  instance: IceCardInstance | IceSectionInstance;
  handle?: "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
  instanceKeys?: readonly string[];
  index?: ReturnType<typeof buildInstanceIndex>;
  members?: readonly { cardId: string; startGeometry: typeof START }[];
  selection?: IceSelection;
  capabilities?: IceCapabilities;
  screen?: { x: number; y: number };
  now?: number;
  typeScale?: number;
}): IceGestureHandle {
  const gesture = beginGesture({
    pointerId: 7,
    screen: input.screen ?? { x: 100, y: 100 },
    target: { entity: 42, type: "suite.card", instance: input.instance, part: "body" },
    camera: CAMERA,
    capabilities: input.capabilities ?? ICE_EDIT_CAPABILITIES,
    now: input.now ?? 1_000,
    ...(input.handle ? { handle: input.handle } : {}),
    ...(input.typeScale === undefined ? {} : { typeScale: input.typeScale }),
    ...(input.instanceKeys ? { instanceKeys: input.instanceKeys } : {}),
    ...(input.index ? { index: input.index } : {}),
    ...(input.members ? { members: input.members } : {}),
    ...(input.selection ? { selection: input.selection } : {}),
  });
  if (!gesture) throw new Error("expected a gesture");
  return gesture;
}

function expectCommit(plan: ReturnType<typeof endGesture>) {
  if (plan?.status !== "commit") {
    throw new Error(
      `expected a commit plan, got ${plan ? `${plan.status}: ${plan.reason}` : "null"}`,
    );
  }
  return plan;
}

describe("iceInteraction picks", () => {
  const index = buildInstanceIndex([card({ instanceKey: "i1", cardId: "card-a" })]);

  it("should resolve a raw pick to its canonical instance", () => {
    const pick = resolvePick(
      { entity: 42, type: "suite.card", instanceKey: "i1", part: "body" },
      index,
    );
    expect(pick).toEqual({
      entity: 42,
      type: "suite.card",
      instance: index.byKey.get("i1"),
      part: "body",
    });
  });

  it("should miss a recycled entity instead of guessing a neighbour", () => {
    expect(resolvePick({ entity: 42, type: "suite.card", instanceKey: "gone" }, index)).toBeNull();
    expect(resolvePick({ entity: 42, type: "suite.card" }, index)).toBeNull();
  });

  it("should resolve through an entity-to-instance-key map", () => {
    const pick = resolvePick({ entity: 42, type: "suite.card" }, index, {
      instanceKeyOf: (raw) => (raw.entity === 42 ? "i1" : null),
    });
    expect(pick?.instance.kind === "card" ? pick.instance.cardId : null).toBe("card-a");
  });
});

describe("iceInteraction gesture thresholds", () => {
  it("should write nothing when the press stays inside the screen threshold", () => {
    const writer = createWriter();
    const gesture = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });

    const live = gesture.update({ screen: { x: 102, y: 101 } });
    expect(live.moved).toBe(false);
    expect(gesture.moved).toBe(false);

    const plan = endGesture(gesture, { screen: { x: 102, y: 101 } });
    expect(plan).toBeNull();
    expect(gesture.status).toBe("ended");
    expect(writer.movePlacements).not.toHaveBeenCalled();
  });

  it("should write nothing when a world-only delta is below the document epsilon", () => {
    const writer = createWriter();
    const gesture = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });

    gesture.update({ worldDelta: { x: 0.2, y: -0.1 } });
    expect(gesture.moved).toBe(false);
    expect(endGesture(gesture)).toBeNull();
    expect(writer.movePlacements).not.toHaveBeenCalled();
  });

  it("should treat a press below the threshold as a click even when the camera is zoomed", () => {
    const gesture = beginGesture({
      pointerId: 1,
      screen: { x: 100, y: 100 },
      target: {
        entity: 1,
        type: "suite.card",
        instance: card({ instanceKey: "i1", cardId: "card-a" }),
      },
      camera: { x: 0, y: 0, zoom: 8 },
      capabilities: ICE_EDIT_CAPABILITIES,
    });
    if (!gesture) throw new Error("expected a gesture");

    gesture.update({ screen: { x: 102, y: 100 } });
    expect(gesture.moved).toBe(false);
    expect(endGesture(gesture)).toBeNull();
  });
});

describe("iceInteraction move gestures", () => {
  it("should commit one movePlacements write in canonical board coordinates", () => {
    const writer = createWriter();
    const gesture = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });

    gesture.update({ screen: { x: 140, y: 130 } });
    expect(gesture.moved).toBe(true);
    expect(gesture.live.target.geometry).toEqual({ x: 50, y: 40, width: 200, height: 120 });

    const plan = expectCommit(endGesture(gesture));
    applyCanonicalWrite(writer, plan.write);

    expect(plan.write).toEqual({
      kind: "movePlacements",
      boardId: "board-1",
      moves: [{ cardId: "card-a", x: 50, y: 40 }],
    });
    expect(writer.movePlacements).toHaveBeenCalledTimes(1);
    expect(writer.movePlacements).toHaveBeenCalledWith("board-1", [
      { cardId: "card-a", x: 50, y: 40 },
    ]);
  });

  it("should inverse-transform a portal instance's scale and translation", () => {
    const writer = createWriter();
    const gesture = press({
      instance: card({
        instanceKey: "portal-i1",
        cardId: "card-a",
        path: ["board-1", "board-2"],
        transform: { scale: 0.5, x: 100, y: 50 },
      }),
    });

    const live = updateGesture(gesture, { worldDelta: { x: 10, y: 10 } });
    expect(live.target.geometry).toEqual({ x: 30, y: 30, width: 200, height: 120 });
    expect(live.target.view).toEqual({ x: 115, y: 65, width: 100, height: 60 });

    const plan = expectCommit(endGesture(gesture));
    applyCanonicalWrite(writer, plan.write);
    expect(writer.movePlacements).toHaveBeenCalledWith("board-1", [
      { cardId: "card-a", x: 30, y: 30 },
    ]);
  });

  it("should commit ICE's snapped rect instead of the raw pointer delta", () => {
    const writer = createWriter();
    const gesture = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });

    // The pointer only travelled 13/7; ICE's snap guide pulled the card to 48/32.
    gesture.update({ worldDelta: { x: 13, y: 7 } });
    const plan = expectCommit(
      endGesture(gesture, { finalGeometry: { x: 48, y: 32, width: 200, height: 120 } }),
    );
    applyCanonicalWrite(writer, plan.write);

    expect(plan.write).toEqual({
      kind: "movePlacements",
      boardId: "board-1",
      moves: [{ cardId: "card-a", x: 48, y: 32 }],
    });
    expect(writer.movePlacements).toHaveBeenCalledTimes(1);
  });

  it("should write nothing when a snap settles back on the start position", () => {
    const gesture = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });
    gesture.update({ worldDelta: { x: 4, y: 4 } });

    const plan = endGesture(gesture, {
      finalGeometry: { x: 10, y: 10, width: 200, height: 120 },
    });
    expect(plan).toEqual({ status: "skip", reason: "no-change" });
  });

  it("should collapse two instances of one card into one canonical move", () => {
    const writer = createWriter();
    const index = buildInstanceIndex([
      card({ instanceKey: "i1", cardId: "card-a" }),
      card({
        instanceKey: "i2",
        cardId: "card-a",
        path: ["board-1", "board-2"],
        transform: { scale: 0.5, x: 100, y: 50 },
      }),
    ]);
    const primary = index.byKey.get("i1");
    if (!primary) throw new Error("expected the primary instance");

    const gesture = press({ instance: primary, index, instanceKeys: ["i1", "i2"] });
    gesture.update({ worldDelta: { x: 10, y: 10 } });

    const plan = expectCommit(endGesture(gesture));
    applyCanonicalWrite(writer, plan.write);
    expect(writer.movePlacements).toHaveBeenCalledTimes(1);
    expect(writer.movePlacements).toHaveBeenCalledWith("board-1", [
      { cardId: "card-a", x: 20, y: 20 },
    ]);
  });

  it("should leave out an instance that lives on another board", () => {
    const index = buildInstanceIndex([
      card({ instanceKey: "i1", cardId: "card-a" }),
      card({ instanceKey: "i2", cardId: "card-b", boardId: "board-2" }),
    ]);
    const primary = index.byKey.get("i1");
    if (!primary) throw new Error("expected the primary instance");

    const gesture = press({ instance: primary, index, instanceKeys: ["i1", "i2"] });
    gesture.update({ worldDelta: { x: 20, y: 20 } });

    expect(gesture.selection.cardIds).toEqual(["card-a"]);
    const plan = expectCommit(endGesture(gesture));
    expect(plan.write).toEqual({
      kind: "movePlacements",
      boardId: "board-1",
      moves: [{ cardId: "card-a", x: 30, y: 30 }],
    });
  });
});

describe("iceInteraction resize gestures", () => {
  it("should commit a card's position and size in one write", () => {
    const writer = createWriter();
    const gesture = press({
      instance: card({ instanceKey: "i1", cardId: "card-a" }),
      handle: "se",
    });

    gesture.update({ worldDelta: { x: 40, y: 20 } });
    expect(gesture.live.target.geometry).toEqual({ x: 10, y: 10, width: 240, height: 140 });

    const plan = expectCommit(endGesture(gesture));
    applyCanonicalWrite(writer, plan.write);
    expect(plan.write).toEqual({
      kind: "resizePlacement",
      boardId: "board-1",
      cardId: "card-a",
      geometry: { x: 10, y: 10, width: 240, height: 140 },
      // Similarity: 240 wide is under the base extent, so the type steps down.
      typeScale: 0.5,
    });
    expect(writer.updatePlacementGeometry).toHaveBeenCalledTimes(1);
  });

  it("should commit a snapped resize rect when ICE reports one", () => {
    const gesture = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }), handle: "e" });
    gesture.update({ worldDelta: { x: 6, y: 0 } });

    const plan = expectCommit(
      endGesture(gesture, { finalGeometry: { x: 10, y: 10, width: 260, height: 120 } }),
    );
    expect(plan.write).toEqual({
      kind: "resizePlacement",
      boardId: "board-1",
      cardId: "card-a",
      geometry: { x: 10, y: 10, width: 260, height: 120 },
      typeScale: 0.5,
    });
  });

  it("should move a section and its members as one write", () => {
    const writer = createWriter();
    const gesture = press({
      instance: section({ instanceKey: "s1", sectionId: "section-a" }),
      members: [{ cardId: "card-a", startGeometry: { x: 100, y: 100, width: 200, height: 120 } }],
    });

    expect(gesture.kind).toBe("section-move");
    gesture.update({ worldDelta: { x: 20, y: 10 } });

    const plan = expectCommit(endGesture(gesture));
    applyCanonicalWrite(writer, plan.write);
    expect(plan.write).toEqual({
      kind: "moveSections",
      input: {
        sections: [{ id: "section-a", x: 120, y: 110 }],
        placements: [{ boardId: "board-1", cardId: "card-a", x: 120, y: 110 }],
      },
    });
    expect(writer.moveSections).toHaveBeenCalledTimes(1);
  });

  it("should resize a section against the section floor", () => {
    const writer = createWriter();
    const gesture = press({
      instance: section({ instanceKey: "s1", sectionId: "section-a" }),
      handle: "e",
    });

    gesture.update({ worldDelta: { x: 50, y: 0 } });
    const plan = expectCommit(endGesture(gesture));
    applyCanonicalWrite(writer, plan.write);

    expect(plan.write).toEqual({
      kind: "resizeSection",
      sectionId: "section-a",
      geometry: { x: 100, y: 100, width: 350, height: 200 },
    });
    expect(writer.updateSectionGeometry).toHaveBeenCalledTimes(1);
  });
});

describe("iceInteraction card resize and the type ladder", () => {
  // A card at its natural size sits on rung 1, so each test can read a rung
  // change as "the drag crossed a threshold".
  const NATURAL = { x: 10, y: 10, width: 288, height: 240 };

  /** A resize of a natural card, held by `handle` and dragged by `delta`. */
  function resize(input: {
    handle: "e" | "se";
    delta: { x: number; y: number };
    shiftKey?: boolean;
    typeScale?: number;
    geometry?: { x: number; y: number; width: number; height: number };
  }): IceGestureHandle {
    const gesture = press({
      instance: card({ instanceKey: "i1", cardId: "card-a", geometry: input.geometry ?? NATURAL }),
      handle: input.handle,
      ...(input.typeScale === undefined ? {} : { typeScale: input.typeScale }),
    });
    gesture.update({
      worldDelta: input.delta,
      ...(input.shiftKey === undefined ? {} : { shiftKey: input.shiftKey }),
    });
    return gesture;
  }

  it("should grow the rung with the box on a similarity drag", () => {
    const gesture = resize({ handle: "e", delta: { x: 288, y: 0 } });
    expect(gesture.reflow).toBe(false);
    // 288 wide → 576: exactly twice the base, so the card takes the 2x hand.
    expect(gesture.live.target.geometry.width).toBe(576);
    expect(gesture.live.target.typeScale).toBe(2);
    expect(gesture.typeScale).toBe(2);

    const plan = expectCommit(endGesture(gesture));
    expect(plan.write).toEqual({
      kind: "resizePlacement",
      boardId: "board-1",
      cardId: "card-a",
      geometry: { x: 10, y: 10, width: 576, height: 240 },
      // The committed rung is the one the projection would read off the box.
      typeScale: 2,
    });
    expect(gesture.typeScale).toBe(scaleForExtent({ width: 576, height: 240 }));
  });

  it("should de-escalate the rung as a similarity drag shrinks the box", () => {
    const gesture = resize({
      handle: "se",
      geometry: { x: 10, y: 10, width: 576, height: 480 },
      delta: { x: -288, y: -240 },
    });
    expect(gesture.typeScale).toBe(1);
    endGesture(gesture);
    expect(gesture.typeScale).toBe(1);
  });

  it("should clamp a similarity drag at the ladder floor", () => {
    // The box floors at ICE_MIN_CARD_SIZE (48 × 32), far below the base extent.
    const gesture = resize({ handle: "se", delta: { x: -400, y: -400 } });
    expect(gesture.live.target.geometry).toEqual({ x: 10, y: 10, width: 48, height: 32 });
    expect(gesture.typeScale).toBe(MIN_CARD_TYPE_SCALE);
  });

  it("should clamp a similarity drag at the ladder's cap", () => {
    const gesture = resize({ handle: "e", delta: { x: 4000, y: 0 } });
    expect(gesture.live.target.geometry.width).toBe(4288);
    expect(gesture.typeScale).toBe(MAX_CARD_TYPE_SCALE);
    endGesture(gesture);
    // Past the cap the box keeps growing as page, not as letters.
    expect(gesture.typeScale).toBe(MAX_CARD_TYPE_SCALE);
  });

  it("should reflow instead of rescaling when Shift is held", () => {
    const gesture = resize({ handle: "e", delta: { x: 288, y: 0 }, shiftKey: true });
    expect(gesture.reflow).toBe(true);
    // The box doubled but the hand stayed on rung 1: the text reflows.
    expect(gesture.live.target.geometry.width).toBe(576);
    expect(gesture.live.target.typeScale).toBe(1);
    expect(gesture.typeScale).toBe(1);
    expect(expectCommit(endGesture(gesture)).write).toEqual({
      kind: "resizePlacement",
      boardId: "board-1",
      cardId: "card-a",
      geometry: { x: 10, y: 10, width: 576, height: 240 },
      // The point of Shift: the box doubled and the rung did not move.
      typeScale: 1,
    });
  });

  it("should never change the rung on a Shift drag, however far it travels", () => {
    for (const delta of [
      { x: 4, y: 0 },
      { x: 288, y: 0 },
      { x: 4000, y: 0 },
      { x: -400, y: -400 },
      { x: -4000, y: -4000 },
    ]) {
      const gesture = resize({ handle: "se", delta, shiftKey: true });
      const before = gesture.typeScale;
      expect(gesture.live.target.typeScale).toBe(1);
      endGesture(gesture);
      expect(gesture.typeScale).toBe(before);
      expect(gesture.typeScale).toBe(1);
    }
  });

  it("should hold a non-base rung pinned through a Shift drag", () => {
    const gesture = resize({
      handle: "se",
      typeScale: MAX_CARD_TYPE_SCALE,
      delta: { x: -300, y: -200 },
      shiftKey: true,
    });
    expect(gesture.typeScale).toBe(MAX_CARD_TYPE_SCALE);
    endGesture(gesture);
    expect(gesture.typeScale).toBe(MAX_CARD_TYPE_SCALE);
  });

  it("should read the modifier at pointer-up, not only mid-drag", () => {
    const gesture = press({
      instance: card({ instanceKey: "i1", cardId: "card-a", geometry: NATURAL }),
      handle: "e",
    });
    gesture.update({ worldDelta: { x: 288, y: 0 } });
    expect(gesture.typeScale).toBe(2);
    // Shift pressed only for the final sample: the commit reflows.
    endGesture(gesture, { shiftKey: true });
    expect(gesture.reflow).toBe(true);
    expect(gesture.typeScale).toBe(1);
  });

  it("should carry no rung on a move or a section resize", () => {
    const move = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });
    move.update({ worldDelta: { x: 40, y: 20 } });
    expect(move.typeScale).toBeNull();
    expect(move.reflow).toBe(false);
    expect(move.live.target.typeScale).toBeUndefined();

    const sectionResize = press({
      instance: section({ instanceKey: "s1", sectionId: "section-a", geometry: NATURAL }),
      handle: "e",
    });
    sectionResize.update({ worldDelta: { x: 400, y: 0 } });
    expect(sectionResize.typeScale).toBeNull();
    expect(sectionResize.live.target.typeScale).toBeUndefined();
  });
});

describe("iceInteraction cancellation and capabilities", () => {
  it("should write nothing when a drag is cancelled", () => {
    const writer = createWriter();
    const gesture = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });
    gesture.update({ worldDelta: { x: 80, y: 60 } });

    gesture.cancel();
    expect(gesture.status).toBe("cancelled");
    expect(gesture.live.items).toEqual([
      expect.objectContaining({ instanceKey: "i1", geometry: START }),
    ]);

    expect(endGesture(gesture)).toBeNull();
    expect(writer.movePlacements).not.toHaveBeenCalled();
  });

  it("should refuse a second gesture while one is active", () => {
    const active = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });
    const second = beginGesture(
      {
        pointerId: 8,
        screen: { x: 10, y: 10 },
        target: {
          entity: 1,
          type: "suite.card",
          instance: card({ instanceKey: "i2", cardId: "card-b" }),
        },
        camera: CAMERA,
        capabilities: ICE_EDIT_CAPABILITIES,
      },
      active,
    );
    expect(second).toBeNull();

    active.cancel();
    const after = beginGesture(
      {
        pointerId: 8,
        screen: { x: 10, y: 10 },
        target: {
          entity: 1,
          type: "suite.card",
          instance: card({ instanceKey: "i2", cardId: "card-b" }),
        },
        camera: CAMERA,
        capabilities: ICE_EDIT_CAPABILITIES,
      },
      active,
    );
    expect(after).not.toBeNull();
  });

  it("should deny a viewer and write nothing", () => {
    const writer = createWriter();
    const gesture = press({
      instance: card({ instanceKey: "i1", cardId: "card-a" }),
      capabilities: ICE_VIEW_CAPABILITIES,
    });
    gesture.update({ worldDelta: { x: 60, y: 40 } });

    const plan = endGesture(gesture);
    expect(plan).toEqual({ status: "denied", reason: "read-only" });
    expect(writer.movePlacements).not.toHaveBeenCalled();
  });

  it("should only ever produce one plan per gesture", () => {
    const writer = createWriter();
    const gesture = press({ instance: card({ instanceKey: "i1", cardId: "card-a" }) });
    gesture.update({ worldDelta: { x: 40, y: 30 } });

    const plan = expectCommit(endGesture(gesture));
    applyCanonicalWrite(writer, plan.write);
    expect(endGesture(gesture, { worldDelta: { x: 90, y: 90 } })).toBeNull();
    expect(writer.movePlacements).toHaveBeenCalledTimes(1);
  });
});

describe("iceInteraction deletes", () => {
  const index = buildInstanceIndex([
    card({ instanceKey: "i1", cardId: "card-a" }),
    card({ instanceKey: "i2", cardId: "card-b" }),
  ]);
  const selection: IceSelection = {
    cardIds: ["card-a", "card-b"],
    sectionIds: [],
    primaryCardId: "card-b",
    primarySectionId: null,
  };

  it("should resolve selected canonical cards to one delete write", () => {
    const writer = createWriter();

    const plan = planDeleteGesture({
      index,
      instanceKeys: ["i1", "i2", "recycled"],
      capabilities: ICE_EDIT_CAPABILITIES,
    });
    expect(plan).toEqual({
      status: "commit",
      write: { kind: "delete", cardIds: ["card-a", "card-b"], sectionIds: [], edgeIds: [] },
    });

    applyCanonicalWrite(writer, expectCommit(plan).write);
    expect(writer.trashCards).toHaveBeenCalledTimes(1);
    expect(writer.trashCards).toHaveBeenCalledWith(["card-a", "card-b"]);
  });

  it("should fall back to the canonical selection when ICE reports no instance", () => {
    const plan = planDeleteGesture({
      index,
      instanceKeys: [],
      current: selection,
      capabilities: ICE_EDIT_CAPABILITIES,
    });
    expect(plan).toEqual({
      status: "commit",
      write: { kind: "delete", cardIds: ["card-a", "card-b"], sectionIds: [], edgeIds: [] },
    });
  });

  it("should skip an empty selection and deny a viewer", () => {
    expect(
      planDeleteGesture({ index, instanceKeys: [], capabilities: ICE_EDIT_CAPABILITIES }),
    ).toEqual({ status: "skip", reason: "empty-selection" });
    expect(
      planDeleteGesture({ index, instanceKeys: ["i1"], capabilities: ICE_VIEW_CAPABILITIES }),
    ).toEqual({ status: "denied", reason: "read-only" });
  });

  it("should resolve a drag-to-trash release from the gesture's selection", () => {
    const primary = index.byKey.get("i1");
    if (!primary) throw new Error("expected the primary instance");

    const gesture = press({
      instance: primary,
      index,
      instanceKeys: ["i1", "i2"],
      selection,
    });
    gesture.update({ worldDelta: { x: 500, y: 0 } });

    expect(endGesture(gesture, { intent: "delete" })).toEqual({
      status: "commit",
      write: { kind: "delete", cardIds: ["card-a", "card-b"], sectionIds: [], edgeIds: [] },
    });
  });
});

describe("iceInteraction keyboard routing", () => {
  function adapter(canUndo = true, canRedo = true): IceUndoAdapter {
    return {
      undo: vi.fn<() => void>(),
      redo: vi.fn<() => void>(),
      canUndo: () => canUndo,
      canRedo: () => canRedo,
    };
  }

  function key(input: Partial<HistoryKeyLike> & { key: string }): HistoryKeyLike {
    return { ...input };
  }

  function element(tag: string, attributes: Record<string, string> = {}): HTMLElement {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  }

  it("should leave contenteditable, input and data-ice-editor targets to the editor", () => {
    const loro = adapter();
    const editable = element("div", { contenteditable: "true" });
    const field = element("input");
    const wrapper = element("div", { [ICE_EDITOR_ATTRIBUTE]: "" });
    const inner = element("span");
    wrapper.append(inner);
    editable.append(document.createTextNode("hello"));

    expect(hasEditableFocus(editable)).toBe(true);
    expect(hasEditableFocus(editable.firstChild)).toBe(true);
    expect(hasEditableFocus(field)).toBe(true);
    expect(hasEditableFocus(inner)).toBe(true);
    expect(hasEditableFocus(element("div"))).toBe(false);
    expect(hasEditableFocus(null)).toBe(false);

    expect(routeIceHistory(key({ key: "z", ctrlKey: true, target: editable }), loro)).toBe(
      "editor",
    );
    expect(routeIceHistory(key({ key: "z", metaKey: true, target: field }), loro)).toBe("editor");
    expect(routeIceHistory(key({ key: "z", metaKey: true, target: inner }), loro)).toBe("editor");
    expect(loro.undo).not.toHaveBeenCalled();
    expect(loro.redo).not.toHaveBeenCalled();
  });

  it("should route undo and redo to Loro away from a text surface", () => {
    const loro = adapter();
    const canvas = element("div");

    expect(routeIceHistory(key({ key: "z", ctrlKey: true, target: canvas }), loro)).toBe("undo");
    expect(loro.undo).toHaveBeenCalledTimes(1);

    expect(
      routeIceHistory(key({ key: "z", ctrlKey: true, shiftKey: true, target: canvas }), loro),
    ).toBe("redo");
    expect(routeIceHistory(key({ key: "y", metaKey: true, target: canvas }), loro)).toBe("redo");
    expect(loro.redo).toHaveBeenCalledTimes(2);
    expect(loro.undo).toHaveBeenCalledTimes(1);

    const preventDefault = vi.fn<() => void>();
    expect(
      routeIceHistory(key({ key: "z", metaKey: true, target: canvas, preventDefault }), loro),
    ).toBe("undo");
    expect(preventDefault).toHaveBeenCalledTimes(1);

    // ICE's own history is never the target of a document gesture.
    expect(ICE_NATIVE_HISTORY_ENABLED).toBe(false);
  });

  it("should leave unrelated keys and exhausted history alone", () => {
    const empty = adapter(false, false);
    const canvas = element("div");

    expect(routeIceHistory(key({ key: "x", ctrlKey: true, target: canvas }), empty)).toBe("none");
    expect(routeIceHistory(key({ key: "z", target: canvas }), empty)).toBe("none");
    expect(
      routeIceHistory(key({ key: "z", ctrlKey: true, altKey: true, target: canvas }), empty),
    ).toBe("none");
    expect(routeIceHistory(key({ key: "z", ctrlKey: true, target: canvas }), empty)).toBe("none");
    expect(empty.undo).not.toHaveBeenCalled();
    expect(empty.redo).not.toHaveBeenCalled();
  });

  it("should respect an event another handler already claimed", () => {
    const loro = adapter();
    const canvas = element("div");

    expect(
      routeIceHistory(
        key({ key: "z", ctrlKey: true, target: canvas, defaultPrevented: true }),
        loro,
      ),
    ).toBe("none");
    expect(loro.undo).not.toHaveBeenCalled();
  });
});

describe("iceInteraction press metadata", () => {
  it("should record the pointer, start points and canonical selection", () => {
    const index = buildInstanceIndex([
      card({ instanceKey: "i1", cardId: "card-a" }),
      card({ instanceKey: "i2", cardId: "card-b" }),
    ]);
    const primary = index.byKey.get("i1");
    if (!primary) throw new Error("expected the primary instance");

    const gesture = press({
      instance: primary,
      index,
      instanceKeys: ["i1", "i2"],
      screen: { x: 250, y: 180 },
      now: 1_234,
    });

    expect(gesture.pointerId).toBe(7);
    expect(gesture.startedAt).toBe(1_234);
    expect(gesture.startScreen).toEqual({ x: 250, y: 180 });
    expect(gesture.startWorld).toEqual({ x: 250, y: 180 });
    expect(gesture.startBoard).toEqual({ x: 250, y: 180 });
    expect(gesture.kind).toBe("move");
    expect(gesture.status).toBe("active");
    expect(gesture.selection.cardIds).toEqual(["card-a", "card-b"]);
    expect(gesture.selection.primaryCardId).toBe("card-a");
    expect(gesture.target.entity).toBe(42);
    expect(ICE_POINTER_THRESHOLD).toBe(3);
  });

  it("should start a gesture inside a zoomed, offset camera", () => {
    const gesture = beginGesture({
      pointerId: 1,
      screen: { x: 100, y: 100 },
      target: {
        entity: 1,
        type: "suite.card",
        instance: card({ instanceKey: "i1", cardId: "card-a" }),
      },
      camera: { x: 50, y: 20, zoom: 2 },
      capabilities: ICE_EDIT_CAPABILITIES,
    });
    if (!gesture) throw new Error("expected a gesture");

    expect(gesture.startWorld).toEqual({ x: 25, y: 40 });
    // 4 screen px = 2 world units; the screen threshold still gates the press.
    gesture.update({ screen: { x: 104, y: 100 } });
    expect(gesture.moved).toBe(true);
    expect(gesture.worldDelta).toEqual({ x: 2, y: 0 });
  });

  it("should refuse a degenerate instance transform", () => {
    const gesture = beginGesture({
      pointerId: 1,
      screen: { x: 10, y: 10 },
      target: {
        entity: 1,
        type: "suite.card",
        instance: card({
          instanceKey: "i1",
          cardId: "card-a",
          transform: { scale: 0, x: 0, y: 0 },
        }),
      },
      camera: CAMERA,
      capabilities: ICE_EDIT_CAPABILITIES,
    });
    expect(gesture).toBeNull();
  });
});
