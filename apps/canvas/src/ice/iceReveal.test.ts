import type { Entity } from "@vibecook/ice";
import { describe, expect, it } from "vitest";

import { boardMatEntity, boardPathTo, pinFocusPoint, revealCamera, revealPlan } from "./iceReveal";
import type { BoardMat } from "./iceSurfaceSpawns";

const ROOT = "board-root";

function mats(entries: readonly [number, string, string][]): Map<Entity, BoardMat> {
  const map = new Map<Entity, BoardMat>();
  for (const [entity, boardId, parentBoardId] of entries) {
    map.set(entity as Entity, { boardId, parentBoardId, title: boardId });
  }
  return map;
}

const TREE = mats([
  [10, "board-a", ROOT],
  [11, "board-b", "board-a"],
]);

describe("boardPathTo", () => {
  it("is empty on the root", () => {
    expect(boardPathTo({ rootBoardId: ROOT, boardId: ROOT, mats: TREE })).toEqual([]);
  });

  it("lists the chain outermost first", () => {
    expect(boardPathTo({ rootBoardId: ROOT, boardId: "board-a", mats: TREE })).toEqual(["board-a"]);
    expect(boardPathTo({ rootBoardId: ROOT, boardId: "board-b", mats: TREE })).toEqual([
      "board-a",
      "board-b",
    ]);
  });

  it("refuses a Board this seed did not draw", () => {
    expect(boardPathTo({ rootBoardId: ROOT, boardId: "board-gone", mats: TREE })).toBeNull();
  });

  it("refuses a chain that does not reach the root", () => {
    const orphan = mats([[20, "board-x", "board-y"]]);
    expect(boardPathTo({ rootBoardId: ROOT, boardId: "board-x", mats: orphan })).toBeNull();
  });

  it("terminates on a cyclic fixture instead of looping", () => {
    const cyclic = mats([
      [30, "a", "b"],
      [31, "b", "a"],
    ]);
    expect(boardPathTo({ rootBoardId: ROOT, boardId: "a", mats: cyclic })).toBeNull();
  });
});

describe("boardMatEntity", () => {
  it("finds the mat a Board is drawn by", () => {
    expect(boardMatEntity(TREE, "board-b")).toBe(11);
    expect(boardMatEntity(TREE, "board-gone")).toBeNull();
  });
});

describe("revealPlan", () => {
  const slots: [Entity, { cardId: string; boardId: string }][] = [
    [40 as Entity, { cardId: "card-plain", boardId: ROOT }],
    [41 as Entity, { cardId: "card-nested", boardId: "board-b" }],
  ];

  it("enters the Board a nested card lives on", () => {
    expect(
      revealPlan({
        target: { kind: "card", id: "card-nested" },
        rootBoardId: ROOT,
        mats: TREE,
        slots,
      }),
    ).toEqual({ path: ["board-a", "board-b"], entity: 41 });
  });

  it("needs no entry for a card on the View's plane", () => {
    expect(
      revealPlan({
        target: { kind: "card", id: "card-plain" },
        rootBoardId: ROOT,
        mats: TREE,
        slots,
      }),
    ).toEqual({ path: [], entity: 40 });
  });

  it("frames a Board by its mat, in the parent's frame", () => {
    expect(
      revealPlan({
        target: { kind: "section", id: "board-b" },
        rootBoardId: ROOT,
        mats: TREE,
        slots,
      }),
    ).toEqual({ path: ["board-a"], entity: 11 });
  });

  it("returns null for a card or a Board the desk does not hold", () => {
    expect(
      revealPlan({
        target: { kind: "card", id: "card-gone" },
        rootBoardId: ROOT,
        mats: TREE,
        slots,
      }),
    ).toBeNull();
    expect(
      revealPlan({
        target: { kind: "section", id: "board-gone" },
        rootBoardId: ROOT,
        mats: TREE,
        slots,
      }),
    ).toBeNull();
  });
});

describe("revealCamera", () => {
  const viewport = { width: 1000, height: 800 };

  it("centres the box and fits it inside the padding", () => {
    const camera = revealCamera({
      rect: { x: 100, y: 200, width: 200, height: 100 },
      viewport,
    });
    expect(camera).not.toBeNull();
    if (camera === null) return;
    // 1000 * 0.76 / 200 = 3.8, capped at 1×.
    expect(camera.zoom).toBe(1);
    expect(camera.x).toBe(100 + 100 - 500);
    expect(camera.y).toBe(200 + 50 - 400);
  });

  it("zooms out for a box larger than the viewport, and never past 1×", () => {
    const camera = revealCamera({
      rect: { x: 0, y: 0, width: 2000, height: 100 },
      viewport,
    });
    expect(camera?.zoom).toBeCloseTo(0.38, 5);
  });

  it("frames a degenerate box at the scale the reader had", () => {
    const camera = revealCamera({ rect: { x: 5, y: 6, width: 0, height: 0 }, viewport });
    expect(camera).toEqual({ x: 5 - 500, y: 6 - 400, zoom: 1 });
  });

  it("refuses geometry it cannot trust", () => {
    expect(
      revealCamera({ rect: { x: 0, y: 0, width: 10, height: 10 }, viewport: null }),
    ).toBeNull();
    expect(
      revealCamera({
        rect: { x: 0, y: 0, width: 10, height: 10 },
        viewport: { width: 0, height: 0 },
      }),
    ).toBeNull();
    expect(
      revealCamera({
        rect: { x: Number.NaN, y: 0, width: 10, height: 10 },
        viewport,
      }),
    ).toBeNull();
  });
});

describe("pinFocusPoint", () => {
  const pinEntities = new Map<string, Entity>([["pin-1", 70 as Entity]]);
  const pins = new Map([["pin-1", { x: 120, y: 240 }]]);

  it("resolves a picked marker to the place its pin stands for", () => {
    expect(
      pinFocusPoint({ entity: 70 as Entity, pinEntities, pinOf: (id) => pins.get(id) }),
    ).toEqual({ x: 120, y: 240 });
  });

  it("ignores a pick that is not a marker", () => {
    expect(
      pinFocusPoint({ entity: 71 as Entity, pinEntities, pinOf: (id) => pins.get(id) }),
    ).toBeNull();
    expect(pinFocusPoint({ entity: null, pinEntities, pinOf: (id) => pins.get(id) })).toBeNull();
  });

  it("ignores a pin the document no longer holds", () => {
    expect(pinFocusPoint({ entity: 70 as Entity, pinEntities, pinOf: () => undefined })).toBeNull();
  });
});
