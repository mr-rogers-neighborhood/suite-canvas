import { describe, expect, it, vi } from "vitest";
import type { CanonicalWriter } from "./iceBridge";
import {
  attachIcePointerEditing,
  createIceEditingController,
  currentFrameOf,
  type IceEditingOptions,
  instanceFor,
  type ScreenPoint,
} from "./iceEditingController";

const ROOT = "board-1";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function writer(): CanonicalWriter & { calls: unknown[] } {
  const calls: unknown[] = [];
  const record =
    <T>(name: string) =>
    (...args: T[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    movePlacements: record("movePlacements"),
    updatePlacementGeometry: record("updatePlacementGeometry"),
    createCard: record("createCard"),
    trashCards: record("trashCards"),
    moveSections: record("moveSections"),
    updateSectionGeometry: record("updateSectionGeometry"),
    updateBoardRect: record("updateBoardRect"),
    deleteSections: record("deleteSections"),
    addEdge: record("addEdge"),
    removeEdges: record("removeEdges"),
    nestBoard: record("nestBoard"),
  } as CanonicalWriter & { calls: unknown[] };
}

function harness(patch: Partial<IceEditingOptions> = {}) {
  const boxes = new Map<number, Box>();
  const slots = new Map([
    [1, { cardId: "card-1", boardId: ROOT }],
    [2, { cardId: "card-2", boardId: ROOT }],
  ]);
  boxes.set(1, { x: 100, y: 100, width: 288, height: 240 });
  boxes.set(2, { x: 500, y: 100, width: 288, height: 240 });
  const canonical = writer();
  const removeCards = vi.fn();
  const afterCommit = vi.fn();

  const options: IceEditingOptions = {
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    pick: () => null,
    rectOf: (entity) => boxes.get(entity) ?? null,
    writer: canonical,
    role: "editor",
    removeCards,
    afterCommit,
    slots,
    rootBoardId: ROOT,
    ...patch,
  };
  const controller = createIceEditingController(options);
  return { controller, boxes, canonical, removeCards, afterCommit, slots };
}

/** Screen point that lands inside a box with the identity camera. */
function inside(box: Box): ScreenPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

describe("iceEditingController", () => {
  it("should not write anything for a press that never travelled", () => {
    const { controller, canonical } = harness({ pick: () => 1 });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    controller.pointerUp(1, start);

    expect(canonical.calls).toHaveLength(0);
  });

  it("should commit one move when the entity's snapped box changed", () => {
    const { controller, canonical, boxes } = harness({ pick: () => 1 });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    // ICE moved and snapped the entity before pointer-up.
    boxes.set(1, { x: 340, y: 260, width: 288, height: 240 });
    controller.pointerUp(1, { x: start.x + 240, y: start.y + 160 });

    expect(canonical.calls).toEqual([
      ["movePlacements", ROOT, [{ cardId: "card-1", x: 340, y: 260 }]],
    ]);
  });

  it("should commit the snapped rect, not the pointer delta", () => {
    const { controller, canonical, boxes } = harness({ pick: () => 1 });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    // The pointer travelled 200px but the snap settled the card at 260px.
    boxes.set(1, { x: 360, y: 100, width: 288, height: 240 });
    controller.pointerUp(1, { x: start.x + 200, y: start.y });

    const [, , moves] = canonical.calls[0] as [string, string, { x: number }[]];
    expect(moves[0]?.x).toBe(360);
  });

  it("should commit position and size for a resize", () => {
    const { controller, canonical, boxes } = harness({ pick: () => 1 });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 100, y: 100, width: 400, height: 300 });
    controller.pointerUp(1, { x: start.x + 112, y: start.y + 60 });

    const call = canonical.calls[0] as unknown[];
    expect(call).toMatchObject([
      "updatePlacementGeometry",
      ROOT,
      "card-1",
      { width: 400, height: 300 },
      // The rung travels with the size: past the base extent but short of the
      // next rung's threshold, so the card stays on the base kind.
      1,
    ]);
  });

  it("should commit a Board's frame once, in the frame the camera is inside", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 7,
      boardSlots: new Map([[7, { boardId: "board-a", parentBoardId: ROOT }]]),
    });
    // ICE reports a mat's box in its parent's frame, which is where the
    // document stores the Board's rect: no origin is invented here.
    boxes.set(7, { x: 44, y: 74, width: 816, height: 280 });
    const start = inside({ x: 44, y: 74, width: 816, height: 280 });

    controller.pointerDown(1, start);
    // The mat was dragged and resized by the gesture: one frame, both parts.
    boxes.set(7, { x: 104, y: 114, width: 936, height: 360 });
    controller.pointerUp(1, start);

    expect(canonical.calls).toEqual([
      ["updateBoardRect", "board-a", { x: 104, y: 114, width: 936, height: 360 }],
    ]);
  });

  it("should not write a Board that a gesture left where it was", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 7,
      boardSlots: new Map([[7, { boardId: "board-a", parentBoardId: ROOT }]]),
    });
    boxes.set(7, { x: 44, y: 74, width: 816, height: 280 });
    const start = inside({ x: 44, y: 74, width: 816, height: 280 });

    controller.pointerDown(1, start);
    controller.pointerUp(1, start);

    expect(canonical.calls).toHaveLength(0);
  });

  it("should keep a Board above the document's floor however small the drag", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 7,
      boardSlots: new Map([[7, { boardId: "board-a", parentBoardId: ROOT }]]),
    });
    boxes.set(7, { x: 44, y: 74, width: 816, height: 280 });
    const start = inside({ x: 44, y: 74, width: 816, height: 280 });

    controller.pointerDown(1, start);
    boxes.set(7, { x: 44, y: 74, width: 12, height: 8 });
    controller.pointerUp(1, start);

    const call = canonical.calls[0] as unknown[];
    expect(call).toMatchObject(["updateBoardRect", "board-a", { width: 80, height: 60 }]);
  });

  it("should write nothing for a viewer", () => {
    const { controller, canonical, boxes } = harness({ pick: () => 1, role: "viewer" });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 400, y: 100, width: 288, height: 240 });
    controller.pointerUp(1, { x: start.x + 300, y: start.y });

    expect(canonical.calls).toHaveLength(0);
  });

  it("should write nothing after a cancelled pointer", () => {
    const { controller, canonical, boxes } = harness({ pick: () => 1 });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 400, y: 100, width: 288, height: 240 });
    controller.pointerCancel(1);

    expect(controller.pointerUp(1, { x: start.x + 300, y: start.y })).toBe(false);
    expect(canonical.calls).toHaveLength(0);
  });

  it("should ignore a press that is not over a projected card", () => {
    const { controller, canonical } = harness({ pick: () => null });

    expect(controller.pointerDown(1, { x: 10, y: 10 })).toBe(false);
    expect(canonical.calls).toHaveLength(0);
  });

  it("should commit a drag inside an entered Board in that Board's coordinates", () => {
    const boxes = new Map<number, Box>([[1, { x: 40, y: 60, width: 288, height: 240 }]]);
    const canonical = writer();
    const nested = createIceEditingController({
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      pick: () => 1,
      rectOf: (entity) => boxes.get(entity) ?? null,
      writer: canonical,
      role: "editor",
      removeCards: vi.fn(),
      slots: new Map([[1, { cardId: "card-1", boardId: "board-a" }]]),
      rootBoardId: ROOT,
      // The camera is inside board-a, so ICE measures in board-a's own units.
      currentFrame: () => ({ boardId: "board-a", path: [ROOT, "board-a"] }),
    });

    expect(nested.pointerDown(1, { x: 100, y: 120 })).toBe(true);
    boxes.set(1, { x: 140, y: 220, width: 288, height: 240 });
    expect(nested.pointerUp(1, { x: 200, y: 280 })).toBe(true);

    expect(canonical.calls).toEqual([
      ["movePlacements", "board-a", [{ cardId: "card-1", x: 140, y: 220 }]],
    ]);
  });

  it("should refuse a press on a Board the camera is not inside", () => {
    // A card the camera cannot measure is one ICE would move without a write:
    // the press is refused instead, which is what makes it immovable.
    const { canonical } = harness({ pick: () => 1 });
    const nested = createIceEditingController({
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      pick: () => 1,
      rectOf: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      writer: canonical,
      role: "editor",
      removeCards: vi.fn(),
      slots: new Map([[1, { cardId: "card-1", boardId: "board-b" }]]),
      rootBoardId: ROOT,
      currentFrame: () => ({ boardId: "board-a", path: [ROOT, "board-a"] }),
    });

    expect(nested.pointerDown(1, { x: 5, y: 5 })).toBe(false);
    expect(canonical.calls).toHaveLength(0);
  });

  it("should drag the whole selection as one write", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 1,
      selection: () => ["card-1", "card-2"],
    });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    expect(controller.pointerDown(1, start)).toBe(true);
    // ICE moves every selected entity; the commit is the snapped boxes.
    boxes.set(1, { x: 340, y: 260, width: 288, height: 240 });
    boxes.set(2, { x: 740, y: 260, width: 288, height: 240 });

    expect(controller.pointerUp(1, { x: start.x + 240, y: start.y + 160 })).toBe(true);
    expect(canonical.calls).toEqual([
      [
        "movePlacements",
        ROOT,
        [
          { cardId: "card-1", x: 340, y: 260 },
          { cardId: "card-2", x: 740, y: 260 },
        ],
      ],
    ]);
  });

  it("should drag only the pressed card when it is not selected", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 1,
      selection: () => ["card-2"],
    });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 340, y: 260, width: 288, height: 240 });
    boxes.set(2, { x: 740, y: 260, width: 288, height: 240 });
    controller.pointerUp(1, { x: start.x + 240, y: start.y + 160 });

    expect(canonical.calls).toEqual([
      ["movePlacements", ROOT, [{ cardId: "card-1", x: 340, y: 260 }]],
    ]);
  });

  it("should move a card dropped into a Board onto that Board", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 1,
      // ICE re-parented the card into Board A's frame.
      containerOf: () => "board-a",
    });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    // The box ICE left it at, already in the new Board's frame.
    boxes.set(1, { x: 24, y: 32, width: 288, height: 240 });

    expect(controller.pointerUp(1, { x: start.x + 240, y: start.y + 160 })).toBe(true);
    expect(canonical.calls).toEqual([
      ["movePlacements", "board-a", [{ cardId: "card-1", x: 24, y: 32, fromBoardId: ROOT }]],
    ]);
  });

  it("should keep a drop that stayed on its own Board a plain move", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 1,
      containerOf: () => ROOT,
    });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 340, y: 260, width: 288, height: 240 });
    controller.pointerUp(1, { x: start.x + 240, y: start.y + 160 });

    expect(canonical.calls).toEqual([
      ["movePlacements", ROOT, [{ cardId: "card-1", x: 340, y: 260 }]],
    ]);
  });

  it("should carry the whole selection into the Board it was dropped in", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 1,
      selection: () => ["card-1", "card-2"],
      containerOf: () => "board-a",
    });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 24, y: 32, width: 288, height: 240 });
    boxes.set(2, { x: 414, y: 32, width: 288, height: 240 });

    expect(controller.pointerUp(1, { x: start.x + 240, y: start.y + 160 })).toBe(true);
    expect(canonical.calls).toEqual([
      [
        "movePlacements",
        "board-a",
        [
          { cardId: "card-1", x: 24, y: 32, fromBoardId: ROOT },
          { cardId: "card-2", x: 414, y: 32, fromBoardId: ROOT },
        ],
      ],
    ]);
  });

  it("should not commit a drop for a press that never travelled", () => {
    const { controller, canonical } = harness({ pick: () => 1, containerOf: () => "board-a" });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);

    expect(controller.pointerUp(1, start)).toBe(false);
    expect(canonical.calls).toHaveLength(0);
  });

  it("should re-parent a Board dropped into another Board", () => {
    const { controller, canonical, boxes } = harness({
      pick: () => 7,
      boardSlots: new Map([[7, { boardId: "board-a", parentBoardId: ROOT }]]),
      containerOf: () => "board-b",
    });
    boxes.set(7, { x: 44, y: 74, width: 816, height: 280 });
    const start = inside({ x: 44, y: 74, width: 816, height: 280 });

    controller.pointerDown(1, start);
    // ICE re-parented the mat and left it at a box in the new Board's frame.
    boxes.set(7, { x: 84, y: 94, width: 816, height: 280 });
    expect(controller.pointerUp(1, { x: start.x + 40, y: start.y + 20 })).toBe(true);

    expect(canonical.calls).toEqual([
      ["nestBoard", "board-a", "board-b"],
      ["updateBoardRect", "board-a", { x: 84, y: 94, width: 816, height: 280 }],
    ]);
  });

  it("should delete the selection through one plan and remove the entities", () => {
    const { controller, canonical, removeCards, afterCommit } = harness();

    expect(controller.deleteSelection(["card-1"])).toBe(true);

    expect((canonical.calls[0] as unknown[])[0]).toBe("trashCards");
    expect(removeCards).toHaveBeenCalledWith(["card-1"]);
    expect(afterCommit).toHaveBeenCalledTimes(1);
  });

  it("should not delete when nothing is selected", () => {
    const { controller, canonical, removeCards } = harness();

    expect(controller.deleteSelection([])).toBe(false);
    expect(canonical.calls).toHaveLength(0);
    expect(removeCards).not.toHaveBeenCalled();
  });

  it("should route undo and redo through the Loro adapter", () => {
    const { controller, afterCommit } = harness();
    const adapter = {
      canUndo: () => true,
      canRedo: () => true,
      undo: vi.fn(),
      redo: vi.fn(),
    };

    expect(controller.undo(adapter)).toBe(true);
    expect(controller.redo(adapter)).toBe(true);
    expect(adapter.undo).toHaveBeenCalledTimes(1);
    expect(adapter.redo).toHaveBeenCalledTimes(1);
    expect(afterCommit).toHaveBeenCalledTimes(2);
  });

  it("should not call the adapter when there is nothing to undo", () => {
    const { controller } = harness();
    const adapter = {
      canUndo: () => false,
      canRedo: () => false,
      undo: vi.fn(),
      redo: vi.fn(),
    };

    expect(controller.undo(adapter)).toBe(false);
    expect(adapter.undo).not.toHaveBeenCalled();
  });

  it("should survive a writer that refuses the write", () => {
    const refusing = writer();
    refusing.movePlacements = () => {
      throw new Error("refused");
    };
    const { controller, boxes, afterCommit } = harness({
      pick: () => 1,
      writer: refusing,
    });
    const start = inside({ x: 100, y: 100, width: 288, height: 240 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 400, y: 100, width: 288, height: 240 });

    expect(controller.pointerUp(1, { x: start.x + 300, y: start.y })).toBe(false);
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("should write one movePin when a marker is dragged", () => {
    const boxes = new Map([[9, { x: 300, y: 300, width: 20, height: 20 }]]);
    const movePin = vi.fn();
    const controller = createIceEditingController({
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      pick: () => 9,
      rectOf: (entity) => boxes.get(entity) ?? null,
      writer: null,
      role: "editor",
      removeCards: vi.fn(),
      slots: new Map(),
      rootBoardId: ROOT,
      pinSlots: new Map([[9, "pin-1"]]),
      movePin,
    });

    expect(controller.pointerDown(1, { x: 310, y: 310 })).toBe(true);
    boxes.set(9, { x: 340, y: 320, width: 20, height: 20 });
    expect(controller.pointerUp(1, { x: 350, y: 330 })).toBe(true);

    expect(movePin).toHaveBeenCalledTimes(1);
    expect(movePin).toHaveBeenCalledWith("pin-1", { x: 350, y: 330 });
  });

  it("should not write a pin that did not move", () => {
    const boxes = new Map([[9, { x: 300, y: 300, width: 20, height: 20 }]]);
    const movePin = vi.fn();
    const controller = createIceEditingController({
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      pick: () => 9,
      rectOf: (entity) => boxes.get(entity) ?? null,
      writer: null,
      role: "editor",
      removeCards: vi.fn(),
      slots: new Map(),
      rootBoardId: ROOT,
      pinSlots: new Map([[9, "pin-1"]]),
      movePin,
    });

    controller.pointerDown(1, { x: 310, y: 310 });
    controller.pointerUp(1, { x: 310, y: 310 });

    expect(movePin).not.toHaveBeenCalled();
  });

  it("should build an identity instance for the root board", () => {
    const instance = instanceFor({ cardId: "c", boardId: ROOT }, [ROOT], {
      x: 5,
      y: 6,
      width: 7,
      height: 8,
    });

    expect(instance).toMatchObject({
      kind: "card",
      instanceKey: "card:c",
      path: [ROOT],
      boardId: ROOT,
      transform: { scale: 1, x: 0, y: 0 },
      geometry: { x: 5, y: 6, width: 7, height: 8 },
      cardId: "c",
    });
  });
});

describe("the frame the camera is inside", () => {
  it("should name the root and its path when nothing is entered", () => {
    expect(currentFrameOf(ROOT, [])).toEqual({ boardId: ROOT, path: [ROOT] });
  });

  it("should name the deepest entered Board and the whole path", () => {
    expect(currentFrameOf(ROOT, [{ id: "board-a" }, { id: "board-b" }])).toEqual({
      boardId: "board-b",
      path: [ROOT, "board-a", "board-b"],
    });
  });
});

describe("attachIcePointerEditing", () => {
  it("should convert client coordinates into container-relative points", () => {
    const root = document.createElement("div");
    root.getBoundingClientRect = () =>
      ({ left: 40, top: 60, right: 640, bottom: 660, width: 600, height: 600 }) as DOMRect;
    document.body.append(root);

    const controller = {
      pointerDown: vi.fn(() => true),
      pointerUp: vi.fn(() => true),
      pointerCancel: vi.fn(),
      deleteSelection: vi.fn(() => false),
      undo: vi.fn(() => false),
      redo: vi.fn(() => false),
      cancel: vi.fn(),
    };
    const detach = attachIcePointerEditing(root, controller);

    root.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 140, clientY: 160, button: 0, pointerId: 7 }),
    );

    expect(controller.pointerDown).toHaveBeenCalledWith(7, { x: 100, y: 100 });
    detach();
    root.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 140, clientY: 160, button: 0, pointerId: 8 }),
    );
    expect(controller.pointerDown).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("should ignore non-primary buttons", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const controller = {
      pointerDown: vi.fn(() => true),
      pointerUp: vi.fn(() => true),
      pointerCancel: vi.fn(),
      deleteSelection: vi.fn(() => false),
      undo: vi.fn(() => false),
      redo: vi.fn(() => false),
      cancel: vi.fn(),
    };
    const detach = attachIcePointerEditing(root, controller);

    root.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 1, clientY: 1, button: 2, pointerId: 9 }),
    );

    expect(controller.pointerDown).not.toHaveBeenCalled();
    detach();
    root.remove();
  });
});
