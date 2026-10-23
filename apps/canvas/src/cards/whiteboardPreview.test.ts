import type { DrawingElement } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { whiteboardPreview } from "./whiteboardPreview";

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

describe("whiteboardPreview", () => {
  it("should return an empty normalized frame for an empty scene", () => {
    const preview = whiteboardPreview([]);
    expect(preview.empty).toBe(true);
    expect(preview.shapes).toEqual([]);
    expect(preview.viewBox.width).toBe(100);
  });

  it("should keep rectangles, ellipses, diamonds, lines and text", () => {
    const preview = whiteboardPreview([
      element({ id: "r", type: "rectangle", strokeColor: "#111111", backgroundColor: "#eeeeee" }),
      element({ id: "e", type: "ellipse", x: 120 }),
      element({ id: "d", type: "diamond", y: 80 }),
      element({
        id: "l",
        type: "arrow",
        x: 10,
        y: 10,
        width: 40,
        height: 20,
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 20 },
        ],
      }),
      element({ id: "t", type: "text", text: "Hello" }),
    ]);

    expect(preview.empty).toBe(false);
    expect(preview.shapes.map((shape) => shape.kind)).toEqual([
      "rect",
      "ellipse",
      "diamond",
      "polyline",
      "text",
    ]);
    expect(preview.shapes[3]?.points).toHaveLength(2);
    expect(preview.shapes[4]?.text).toBe("Hello");
  });

  it("should ignore tombstones and transparent fills", () => {
    const preview = whiteboardPreview([
      element({ id: "gone", type: "rectangle", deletedAt: 1 }),
      element({ id: "live", type: "rectangle", backgroundColor: "transparent" }),
    ]);

    expect(preview.shapes).toHaveLength(1);
    expect(preview.shapes[0]?.fill).toBe("none");
  });
});
