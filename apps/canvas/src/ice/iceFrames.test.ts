import type { Board, Rect } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  clipToRect,
  frameLocalPoint,
  frameLocalRect,
  linkDrawFrame,
  throughEndsOf,
} from "./iceFrames";

/** A stored Board, built by hand: these tests read the tree and nothing else. */
function board(id: string, rect: Rect, parentBoardId?: string): Board {
  return {
    id,
    name: id,
    rect,
    z: 0,
    ...(parentBoardId === undefined ? {} : { parentBoardId }),
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * root (the View)
 *  └── outer      at (100, 100), 400×300
 *       └── inner at (50, 50), 200×100   — world (150, 150)
 */
const OUTER = board("outer", { x: 100, y: 100, width: 400, height: 300 }, "root");
const INNER = board("inner", { x: 50, y: 50, width: 200, height: 100 }, "outer");
const BOARDS: readonly Board[] = [OUTER, INNER];

const FRAME: Rect = { x: 0, y: 0, width: 100, height: 100 };

describe("clipToRect", () => {
  it("should leave a segment wholly inside untouched", () => {
    const clip = clipToRect({ x: 10, y: 20 }, { x: 80, y: 60 }, FRAME);
    expect(clip).toEqual({
      from: { x: 10, y: 20 },
      to: { x: 80, y: 60 },
      clippedSource: false,
      clippedTarget: false,
    });
  });

  it("should refuse a segment wholly outside", () => {
    expect(clipToRect({ x: 200, y: 200 }, { x: 300, y: 260 }, FRAME)).toBeNull();
    // Outside, but aimed at the rect: an infinite line would hit it, the
    // segment does not.
    expect(clipToRect({ x: -50, y: 200 }, { x: -10, y: 200 }, FRAME)).toBeNull();
  });

  it("should cut a segment crossing once at the wall it leaves by", () => {
    const clip = clipToRect({ x: 50, y: 50 }, { x: 250, y: 50 }, FRAME);
    expect(clip).not.toBeNull();
    expect(clip?.from).toEqual({ x: 50, y: 50 });
    expect(clip?.to).toEqual({ x: 100, y: 50 });
    expect(clip?.clippedSource).toBe(false);
    expect(clip?.clippedTarget).toBe(true);
    expect(throughEndsOf(clip as NonNullable<typeof clip>)).toEqual(["target"]);
  });

  it("should cut a segment that crosses twice at both walls", () => {
    const clip = clipToRect({ x: -50, y: 50 }, { x: 250, y: 50 }, FRAME);
    expect(clip?.from).toEqual({ x: 0, y: 50 });
    expect(clip?.to).toEqual({ x: 100, y: 50 });
    expect(clip?.clippedSource).toBe(true);
    expect(clip?.clippedTarget).toBe(true);
    expect(throughEndsOf(clip as NonNullable<typeof clip>)).toEqual(["source", "target"]);
  });

  it("should treat a segment touching an edge as the touch point, not a crossing", () => {
    const clip = clipToRect({ x: -50, y: 40 }, { x: 0, y: 40 }, FRAME);
    expect(clip).toEqual({
      from: { x: 0, y: 40 },
      to: { x: 0, y: 40 },
      clippedSource: true,
      clippedTarget: false,
    });
    // An end already on the wall is not cut: nothing to mark.
    const onWall = clipToRect({ x: 0, y: 40 }, { x: 60, y: 40 }, FRAME);
    expect(onWall).toEqual({
      from: { x: 0, y: 40 },
      to: { x: 60, y: 40 },
      clippedSource: false,
      clippedTarget: false,
    });
  });

  it("should answer a degenerate segment only when its point is inside", () => {
    expect(clipToRect({ x: 30, y: 30 }, { x: 30, y: 30 }, FRAME)).toEqual({
      from: { x: 30, y: 30 },
      to: { x: 30, y: 30 },
      clippedSource: false,
      clippedTarget: false,
    });
    expect(clipToRect({ x: 300, y: 30 }, { x: 300, y: 30 }, FRAME)).toBeNull();
    // A point exactly on the wall counts as inside it — the wall is the limit.
    expect(clipToRect({ x: 100, y: 100 }, { x: 100, y: 100 }, FRAME)).not.toBeNull();
  });
});

describe("frameLocalPoint", () => {
  it("should take the frame's own origin away", () => {
    expect(frameLocalPoint({ x: 260, y: 340 }, { x: 150, y: 150 })).toEqual({ x: 110, y: 190 });
    // A card placed at the frame's origin is at (0, 0) inside it.
    expect(frameLocalPoint({ x: 150, y: 150 }, { x: 150, y: 150 })).toEqual({ x: 0, y: 0 });
  });

  it("should state a frame's inside rect from its origin", () => {
    expect(frameLocalRect({ x: 150, y: 150, width: 200, height: 100 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });
});

describe("linkDrawFrame", () => {
  it("should draw on its own frame while the camera is on the plane", () => {
    expect(linkDrawFrame({ frame: "root", entered: [], boards: BOARDS })).toEqual({
      boardId: "root",
      clip: null,
      crossed: false,
    });
  });

  it("should draw on its own frame when the camera is inside it", () => {
    expect(linkDrawFrame({ frame: "outer", entered: ["outer"], boards: BOARDS })).toEqual({
      boardId: "outer",
      clip: null,
      crossed: false,
    });
  });

  it("should re-draw an ancestor's link inside the entered Board, cut at its rect", () => {
    expect(linkDrawFrame({ frame: "root", entered: ["outer"], boards: BOARDS })).toEqual({
      boardId: "outer",
      clip: { x: 0, y: 0, width: 400, height: 300 },
      crossed: true,
    });
  });

  it("should use the deepest entered Board, not the first", () => {
    expect(linkDrawFrame({ frame: "root", entered: ["outer", "inner"], boards: BOARDS })).toEqual({
      boardId: "inner",
      clip: { x: 0, y: 0, width: 200, height: 100 },
      crossed: true,
    });
    // `outer` is still an ancestor of `inner`, so its links cross one wall too.
    expect(linkDrawFrame({ frame: "outer", entered: ["outer", "inner"], boards: BOARDS })).toEqual({
      boardId: "inner",
      clip: { x: 0, y: 0, width: 200, height: 100 },
      crossed: true,
    });
  });

  it("should leave a link below the entered Board alone — it is already there", () => {
    expect(linkDrawFrame({ frame: "inner", entered: ["outer"], boards: BOARDS })).toEqual({
      boardId: "inner",
      clip: null,
      crossed: false,
    });
  });
});
