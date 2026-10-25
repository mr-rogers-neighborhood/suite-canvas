import type { DrawingElement } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  EMPTY_WHITEBOARD_FACE,
  WHITEBOARD_SKETCH_COLUMNS,
  WHITEBOARD_SKETCH_LEVELS,
  WHITEBOARD_SKETCH_ROWS,
  whiteboardFace,
  whiteboardSketch,
  whiteboardSketchBody,
} from "./suiteWhiteboardFace";

const element = (
  overrides: Partial<DrawingElement> & { id: string; type: string },
): DrawingElement =>
  ({
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    ...overrides,
  }) as DrawingElement;

const baseline = WHITEBOARD_SKETCH_LEVELS[0];
const tallest = WHITEBOARD_SKETCH_LEVELS[WHITEBOARD_SKETCH_LEVELS.length - 1];

describe("whiteboardFace", () => {
  it("should say a blank board has nothing drawn", () => {
    expect(whiteboardFace(null)).toBe(EMPTY_WHITEBOARD_FACE);
    expect(whiteboardFace([])).toBe(EMPTY_WHITEBOARD_FACE);
  });

  it("should count the live strokes and ignore tombstones", () => {
    const face = whiteboardFace([
      element({ id: "a", type: "rectangle" }),
      element({ id: "b", type: "ellipse", x: 200 }),
      element({ id: "gone", type: "rectangle", x: 400, deletedAt: 7 }),
    ]);
    expect(face.strokes).toBe(2);
    expect(face.empty).toBe(false);
    expect(face.sketch).toHaveLength(WHITEBOARD_SKETCH_ROWS);
  });

  it("should sketch the strokes' extents as block characters, one line per row", () => {
    const face = whiteboardFace([
      element({ id: "left", type: "rectangle", x: 0, y: 0, width: 100, height: 100 }),
      element({ id: "right", type: "rectangle", x: 200, y: 0, width: 100, height: 100 }),
    ]);
    for (const line of face.sketch) {
      expect(line).toHaveLength(WHITEBOARD_SKETCH_COLUMNS);
      for (const character of line) expect(WHITEBOARD_SKETCH_LEVELS).toContain(character);
    }
    // Two boxes side by side: the halves they cover are taller than the gap,
    // and the normalization centres them, so the coverage lands in the middle row.
    expect(face.sketch[0]).toBe(baseline.repeat(WHITEBOARD_SKETCH_COLUMNS));
    const middle = face.sketch[1] ?? "";
    expect(middle[1]).toBe(tallest);
    expect(middle[Math.floor(WHITEBOARD_SKETCH_COLUMNS / 2)]).toBe(baseline);
  });

  it("should keep the grid aligned: a blank cell is the lowest block, never a space", () => {
    const sketch = whiteboardSketch([element({ id: "one", type: "text", x: 0, y: 0 })]);
    for (const line of sketch) expect(line).not.toContain(" ");
  });

  it("should sketch nothing for a board with nothing on it", () => {
    expect(whiteboardSketch([])).toEqual([]);
  });

  it("should hand the sketch to the flow as the body lines", () => {
    const face = whiteboardFace([element({ id: "a", type: "rectangle" })]);
    expect(whiteboardSketchBody(face).split("\n")).toHaveLength(WHITEBOARD_SKETCH_ROWS);
    expect(whiteboardSketchBody(EMPTY_WHITEBOARD_FACE)).toBe("");
  });

  it("should grade a cell by how much of it the strokes fill", () => {
    // A wide box on the left and a small one far right: the cells over the box
    // are solid, the empty middle is the baseline — that is the sketch.
    const sketch = whiteboardSketch([
      element({ id: "block", type: "rectangle", x: 0, y: 0, width: 200, height: 100 }),
      element({ id: "dot", type: "rectangle", x: 600, y: 0, width: 20, height: 20 }),
    ]);
    const over = sketch[1]?.[0] ?? baseline;
    expect(WHITEBOARD_SKETCH_LEVELS.indexOf(over as never)).toBeGreaterThan(0);
    expect(sketch[1]?.[12]).toBe(baseline);
  });

  it("should read a rule with no height as an extent, not as nothing", () => {
    // An Excalidraw arrow is often 0 tall before it is bound; the preview keeps
    // half a unit, so the sketch still marks the row it lies on.
    const sketch = whiteboardSketch([
      element({ id: "rule", type: "arrow", x: 0, y: 120, width: 240, height: 0 }),
    ]);
    expect(sketch.join("")).not.toBe(
      WHITEBOARD_SKETCH_LEVELS[0].repeat(WHITEBOARD_SKETCH_COLUMNS * 3),
    );
  });
});
