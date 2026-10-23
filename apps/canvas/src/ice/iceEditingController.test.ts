import { describe, expect, it, vi } from "vitest";
import type { CanonicalWriter } from "./iceBridge";
import {
  attachIcePointerEditing,
  createIceEditingController,
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
    deleteSections: record("deleteSections"),
    addEdge: record("addEdge"),
    removeEdges: record("removeEdges"),
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
    ]);
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

  it("should refuse a press inside a nested board until the transform is wired", () => {
    const { controller, canonical } = harness({ pick: () => 1 });
    const slots = new Map([[1, { cardId: "card-1", boardId: "nested-board" }]]);
    const nested = createIceEditingController({
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      pick: () => 1,
      rectOf: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      writer: canonical,
      role: "editor",
      removeCards: vi.fn(),
      slots,
      rootBoardId: ROOT,
    });

    expect(nested.pointerDown(1, { x: 5, y: 5 })).toBe(false);
    expect(controller.pointerDown(1, { x: 110, y: 110 })).toBe(true);
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

  it("should build an identity instance for the root board", () => {
    const instance = instanceFor({ cardId: "c", boardId: ROOT }, ROOT, {
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
