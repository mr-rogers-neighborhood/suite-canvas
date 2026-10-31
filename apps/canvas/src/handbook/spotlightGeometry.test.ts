import { describe, expect, it } from "vitest";
import { spotlightGeometry } from "./spotlightGeometry";

const viewport = { x: 0, y: 0, width: 1000, height: 700 };
const anchor = { x: 700, y: 300, width: 260, height: 30 };

describe("spotlightGeometry", () => {
  it("should outline a target on screen and meet it from the side facing the row", () => {
    const target = { x: 100, y: 100, width: 200, height: 80 };
    const geometry = spotlightGeometry(anchor, target, viewport);
    expect(geometry.offscreen).toBe(false);
    expect(geometry.outline).toEqual(target);
    // The line starts at the row (its top edge here, because the target is up and to the left)
    // and meets the target's right edge, so it never crosses the thing it points at.
    expect(geometry.line?.x1).toBe(830);
    expect(geometry.line?.y1).toBe(300);
    expect(geometry.line?.x2).toBe(300);
    expect(geometry.line?.y2).toBe(140);
  });

  it("should stop at the viewport edge when the target is off screen", () => {
    const geometry = spotlightGeometry(
      anchor,
      { x: 1400, y: 100, width: 200, height: 80 },
      viewport,
    );
    expect(geometry.offscreen).toBe(true);
    expect(geometry.outline).toBeNull();
    expect(geometry.line?.x2).toBe(988);
    expect(geometry.line?.y2).toBe(140);
  });

  it("should clamp a target that is half off the screen rather than dragging the camera", () => {
    const geometry = spotlightGeometry(
      anchor,
      { x: 900, y: -20, width: 200, height: 80 },
      viewport,
    );
    expect(geometry.offscreen).toBe(false);
    expect(geometry.outline?.y).toBe(0);
    expect(geometry.outline?.x).toBe(900);
  });

  it("should outline but not point when the row is inside the thing it describes", () => {
    // The article about the handbook itself: the row lives in the panel it documents.
    const panel = { x: 600, y: 100, width: 360, height: 460 };
    const row = { x: 610, y: 300, width: 300, height: 30 };
    const geometry = spotlightGeometry(row, panel, viewport);
    expect(geometry.outline).toEqual(panel);
    expect(geometry.line).toBeNull();
  });

  it("should draw nothing without both ends", () => {
    expect(spotlightGeometry(null, { x: 1, y: 1, width: 1, height: 1 }, viewport).line).toBeNull();
    expect(spotlightGeometry(anchor, null, viewport).line).toBeNull();
  });
});
