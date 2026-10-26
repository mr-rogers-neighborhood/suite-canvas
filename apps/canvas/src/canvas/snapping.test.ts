import { describe, expect, it } from "vitest";
import { SNAP_THRESHOLD, type SnapRect, snapRect } from "./snapping";

/**
 * Snapping is what makes a hand-arranged board stay arranged: a card lands on
 * another card's edge or centre, and the guide drawn while it is close is the
 * line the drop actually commits.
 */

const box = (x: number, y: number, width = 200, height = 100): SnapRect => ({
  x,
  y,
  width,
  height,
});

const size = { width: 100, height: 50 };

describe("snapping a dragged box", () => {
  it("moves a left edge onto another card's left edge", () => {
    const result = snapRect({ position: { x: 404, y: 500 }, size, others: [box(400, 0)] });

    expect(result.position).toEqual({ x: 400, y: 500 });
    expect(result.guides).toEqual([
      // The guide runs over both boxes, with the overhang on either end.
      { axis: "x", at: 400, start: -12, end: 562 },
    ]);
  });

  it("aligns centres when the centres are the closer pair", () => {
    // The moving box is centred on x=451; the other box is centred on 450.
    const result = snapRect({ position: { x: 401, y: 500 }, size, others: [box(350, 0)] });

    expect(result.position.x).toBe(400);
    expect(result.guides[0]).toMatchObject({ axis: "x", at: 450 });
  });

  it("snaps both axes in one move", () => {
    const result = snapRect({
      position: { x: 403, y: 203 },
      size,
      others: [box(400, 100)],
    });

    expect(result.position).toEqual({ x: 400, y: 200 });
    expect(result.guides.map((guide) => guide.axis)).toEqual(["x", "y"]);
  });

  it("leaves a position alone beyond the threshold", () => {
    const far = SNAP_THRESHOLD + 1;
    const result = snapRect({
      position: { x: 400 + far, y: 500 },
      size,
      others: [box(400, 0)],
    });

    expect(result.position).toEqual({ x: 400 + far, y: 500 });
    expect(result.guides).toEqual([]);
  });

  it("has nothing to snap to on an empty board", () => {
    const result = snapRect({ position: { x: 12, y: 34 }, size, others: [] });

    expect(result.position).toEqual({ x: 12, y: 34 });
    expect(result.guides).toEqual([]);
  });

  it("draws one guide through every box sharing the matched line", () => {
    // Two cards start at x=400; the guide spans both of them and the mover.
    const result = snapRect({
      position: { x: 404, y: 500 },
      size,
      others: [box(400, 0, 200, 100), box(400, 300, 200, 100)],
    });

    expect(result.guides).toEqual([{ axis: "x", at: 400, start: -12, end: 562 }]);
  });

  it("can be turned off by a threshold of zero", () => {
    const result = snapRect({
      position: { x: 402, y: 500 },
      size,
      others: [box(400, 0)],
      threshold: 0,
    });

    expect(result.position.x).toBe(402);
  });
});
