import { describe, expect, it } from "vitest";
import {
  boardToScreen,
  composeTransform,
  effectiveScale,
  fitScale,
  fitTransform,
  inverseTransformPoint,
  invertTransform,
  pageToScreen,
  rectContainsPoint,
  rectContainsRect,
  rectFromPoints,
  rectIntersection,
  rectUnion,
  rectUnionAll,
  screenToBoard,
  screenToPage,
  transformPoint,
  transformRect,
} from "./geometry.js";
import type { Camera, Transform } from "./types.js";

const camera: Camera = { x: 40, y: -20, zoom: 1.5 };
const boardTransform: Transform = { scale: 0.25, x: 100, y: 50 };

describe("transform composition", () => {
  it("should compose into the same mapping as nesting", () => {
    const outer: Transform = { scale: 2, x: 10, y: -5 };
    const inner: Transform = { scale: 0.5, x: 3, y: 4 };
    const composed = composeTransform(outer, inner);
    const target = { x: 7, y: 11 };
    const nested = transformPoint(outer, transformPoint(inner, target));
    expect(transformPoint(composed, target)).toEqual(nested);
    expect(composed).toEqual({ scale: 1, x: 16, y: 3 });
  });

  it("should invert back to the original point", () => {
    const composed = composeTransform({ scale: 2, x: 10, y: -5 }, { scale: 0.5, x: 3, y: 4 });
    const target = { x: 7, y: 11 };
    const mapped = transformPoint(composed, target);
    expect(inverseTransformPoint(composed, mapped)).toEqual(target);
    expect(invertTransform(composed)).toEqual({ scale: 1, x: -16, y: -3 });
  });

  it("should refuse to invert a degenerate transform", () => {
    expect(invertTransform({ scale: 0, x: 1, y: 2 })).toBeNull();
    expect(inverseTransformPoint({ scale: 0, x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it("should transform a rect", () => {
    expect(transformRect({ scale: 2, x: 5, y: 7 }, { x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 7,
      y: 11,
      width: 6,
      height: 8,
    });
  });
});

describe("camera conversions", () => {
  it("should round-trip page through screen", () => {
    const target = { x: 123, y: -45 };
    const screen = pageToScreen(camera, target);
    expect(screen).toEqual({ x: 224.5, y: -87.5 });
    expect(screenToPage(camera, screen)).toEqual(target);
  });

  it("should round-trip board through screen", () => {
    const target = { x: 12, y: 34 };
    const screen = boardToScreen(camera, boardTransform, target);
    expect(screenToBoard(camera, boardTransform, screen)).toEqual(target);
  });

  it("should multiply camera zoom by ancestor scale", () => {
    expect(effectiveScale(camera, boardTransform)).toBeCloseTo(0.375);
    expect(effectiveScale(camera)).toBeCloseTo(1.5);
  });

  it("should treat a non-positive zoom as 1", () => {
    expect(screenToPage({ x: 10, y: 10, zoom: 0 }, { x: 20, y: 20 })).toEqual({ x: 10, y: 10 });
  });
});

describe("fit math", () => {
  it("should fit bounds into a frame and centre them", () => {
    const bounds = { x: 0, y: 0, width: 400, height: 200 };
    const frame = { x: 0, y: 0, width: 300, height: 300 };
    expect(fitScale(bounds, frame)).toBe(0.75);
    const fit = fitTransform(bounds, frame);
    expect(fit.scale).toBe(0.75);
    expect(transformPoint(fit, { x: 0, y: 0 })).toEqual({ x: 0, y: 75 });
    expect(transformRect(fit, bounds)).toEqual({ x: 0, y: 75, width: 300, height: 150 });
  });

  it("should apply padding to the scale", () => {
    const fit = fitTransform(
      { x: 0, y: 0, width: 400, height: 200 },
      { x: 0, y: 0, width: 300, height: 300 },
      0.8,
    );
    expect(fit.scale).toBeCloseTo(0.6);
  });

  it("should account for a non-zero bounds origin", () => {
    const fit = fitTransform(
      { x: 100, y: 50, width: 400, height: 200 },
      { x: 0, y: 0, width: 300, height: 300 },
    );
    expect(transformPoint(fit, { x: 100, y: 50 })).toEqual({ x: 0, y: 75 });
  });

  it("should return zero scale for degenerate inputs", () => {
    expect(fitScale({ width: 0, height: 10 }, { width: 100, height: 100 })).toBe(0);
    expect(fitScale({ width: 10, height: 10 }, { width: 0, height: 100 })).toBe(0);
    expect(fitScale({ width: 10, height: 10 }, { width: 100, height: 100 }, 0)).toBe(0);
  });
});

describe("rect helpers", () => {
  it("should union and intersect", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(rectUnion(a, b)).toEqual({ x: 0, y: 0, width: 15, height: 15 });
    expect(rectIntersection(a, b)).toEqual({ x: 5, y: 5, width: 5, height: 5 });
  });

  it("should call touching rects disjoint", () => {
    expect(
      rectIntersection(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10, y: 0, width: 10, height: 10 },
      ),
    ).toBeNull();
  });

  it("should union a list or report empty", () => {
    expect(rectUnionAll([])).toBeNull();
    expect(
      rectUnionAll([
        { x: 0, y: 0, width: 4, height: 4 },
        { x: 10, y: 10, width: 2, height: 2 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 12, height: 12 });
  });

  it("should test containment with tolerance", () => {
    const outer = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectContainsPoint(outer, { x: 10, y: 10 })).toBe(true);
    expect(rectContainsPoint(outer, { x: 10.5, y: 10.5 })).toBe(false);
    expect(rectContainsRect(outer, { x: -0.4, y: 0, width: 1, height: 1 }, 0.5)).toBe(true);
  });

  it("should build a rect from two points", () => {
    expect(rectFromPoints({ x: 10, y: 8 }, { x: 2, y: 3 })).toEqual({
      x: 2,
      y: 3,
      width: 8,
      height: 5,
    });
  });
});
