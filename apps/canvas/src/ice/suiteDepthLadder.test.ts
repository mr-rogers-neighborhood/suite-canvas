import { describe, expect, it } from "vitest";
import {
  CARD_BASE_SCALE,
  cardTypeForScale,
  MAX_CARD_TYPE_SCALE,
  MIN_CARD_TYPE_SCALE,
} from "./suiteCardScale";
import {
  depthCardTypeForScale,
  depthRungForPlacement,
  depthRungForScale,
  depthScaleOfPlacement,
} from "./suiteDepthLadder";

const BASE_RUNG = CARD_BASE_SCALE;
const FLOOR_RUNG = MIN_CARD_TYPE_SCALE;
const TOP_RUNG = MAX_CARD_TYPE_SCALE;

describe("depthRungForScale", () => {
  it("should map the base scale to the base rung", () => {
    expect(depthRungForScale(1)).toBe(BASE_RUNG);
  });

  it("should never decrease as the scale grows", () => {
    const scales = [0.05, 0.25, 0.5, 0.9, 1, 1.25, 1.75, 2, 2.9, 3, 64];
    const rungs = scales.map((scale) => depthRungForScale(scale));
    for (let index = 1; index < rungs.length; index += 1) {
      const previous = rungs[index - 1];
      const current = rungs[index];
      if (previous === null || previous === undefined) throw new Error("expected a rung");
      if (current === null || current === undefined) throw new Error("expected a rung");
      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  it("should clamp to the ladder's range", () => {
    expect(depthRungForScale(0.01)).toBe(FLOOR_RUNG);
    expect(depthRungForScale(0.49)).toBe(FLOOR_RUNG);
    expect(depthRungForScale(1.9)).toBe(BASE_RUNG);
    expect(depthRungForScale(2.5)).toBe(2);
    expect(depthRungForScale(3)).toBe(TOP_RUNG);
    expect(depthRungForScale(1000)).toBe(TOP_RUNG);
  });

  it("should return null for scales it cannot express", () => {
    expect(depthRungForScale(0)).toBeNull();
    expect(depthRungForScale(-1)).toBeNull();
    expect(depthRungForScale(Number.NaN)).toBeNull();
    expect(depthRungForScale(Number.POSITIVE_INFINITY)).toBeNull();
    expect(depthRungForScale(undefined)).toBeNull();
    expect(depthRungForScale(null)).toBeNull();
  });
});

describe("depthRungForPlacement", () => {
  it("should read the scale a fractal plan carried", () => {
    expect(depthRungForPlacement({ scale: 1 })).toBe(BASE_RUNG);
    expect(depthRungForPlacement({ scale: 2 })).toBe(2);
    expect(depthRungForPlacement({ scale: 3 })).toBe(TOP_RUNG);
  });

  it("should treat a flat plan's placement as base size", () => {
    expect(depthScaleOfPlacement({ scale: undefined })).toBe(1);
    expect(depthRungForPlacement({ scale: undefined })).toBe(BASE_RUNG);
  });
});

describe("depthCardTypeForScale", () => {
  it("should name the registered type of the rung", () => {
    expect(depthCardTypeForScale(1)).toBe(cardTypeForScale(BASE_RUNG));
    expect(depthCardTypeForScale(0.5)).toBe(cardTypeForScale(FLOOR_RUNG));
    expect(depthCardTypeForScale(2)).toBe(cardTypeForScale(2));
  });

  it("should return null when the ladder cannot express the scale", () => {
    expect(depthCardTypeForScale(0)).toBeNull();
    expect(depthCardTypeForScale(Number.NaN)).toBeNull();
  });
});
