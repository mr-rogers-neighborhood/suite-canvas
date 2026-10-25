import { describe, expect, it } from "vitest";

import {
  BOARD_MAT_MIN_DELTA_E,
  BOARD_MAT_MIN_VALUE_STEP,
  boardMatContrast,
  boardMatDistance,
  boardMatGround,
  boardMatLuminance,
  boardMatPairs,
  boardMatVerdict,
  SUITE_BOARD_MATS,
} from "./suiteBoardMats";
import { SUITE_DESK_MAT } from "./suiteDeskTheme";

/**
 * The evidence ADR-0043 §5 asks for: six Board colours are six mats, and they
 * stay six once the desk is lit.
 *
 * The lights are the themes' own: the same albedo is handed to the mat pass,
 * and the pass is lit with the desk's light. So the check has two halves — the
 * albedos must be pairwise distinct in hue *and* value (a monotone light cannot
 * merge two values), and each mat must read off its theme's ground (a mat that
 * matches its desk is not a container).
 */
describe("the six Board mats", () => {
  it("should map every board colour to a vinyl of its own", () => {
    expect(SUITE_BOARD_MATS.map((mat) => mat.color)).toEqual([
      "slate",
      "blue",
      "green",
      "amber",
      "rose",
      "violet",
    ]);
    expect(new Set(SUITE_BOARD_MATS.map((mat) => mat.vinyl)).size).toBe(6);
    expect(new Set(SUITE_BOARD_MATS.map((mat) => mat.ink)).size).toBe(6);
  });

  it("should keep every pair of mats visibly apart", () => {
    const closest = boardMatPairs()[0];
    expect(closest).toBeDefined();
    // The nearest pair — the one that decides whether the palette has six mats.
    expect(closest?.distance).toBeGreaterThanOrEqual(BOARD_MAT_MIN_DELTA_E);
  });

  it("should differ in value as well as hue, which is what a night chain cannot merge", () => {
    const nearest = [...boardMatPairs()].sort((a, b) => a.valueStep - b.valueStep)[0];
    expect(nearest).toBeDefined();
    expect(nearest?.valueStep).toBeGreaterThanOrEqual(BOARD_MAT_MIN_VALUE_STEP);
    // A per-channel monotone light cannot turn two different values into one.
    const values = SUITE_BOARD_MATS.map((mat) => boardMatLuminance(mat.ink));
    expect(new Set(values.map((value) => value.toFixed(3))).size).toBe(6);
  });

  it("should read off the desk in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const ground = boardMatGround(theme);
      for (const mat of SUITE_BOARD_MATS) {
        expect({
          theme,
          mat: mat.color,
          contrast: boardMatContrast(mat.ink, ground),
        }).toMatchObject({
          contrast: expect.any(Number),
        });
        // A mat is a large surface, not a glyph: it needs to be a material
        // against the felt, not a 4.5:1 text ratio. Every mat is above 2:1 of
        // its own desk in both themes, which is where a sheet stops being felt.
        expect(boardMatContrast(mat.ink, ground)).toBeGreaterThan(2);
      }
    }
  });

  it("should answer the same verdict for both themes, and say there are six", () => {
    for (const theme of ["light", "dark"] as const) {
      const verdict = boardMatVerdict(theme);
      expect(verdict.theme).toBe(theme);
      expect(verdict.ground).toBe(boardMatGround(theme));
      expect(verdict.distinct).toBe(true);
      expect(verdict.closest.distance).toBeGreaterThanOrEqual(BOARD_MAT_MIN_DELTA_E);
      expect(verdict.closestValue.valueStep).toBeGreaterThanOrEqual(BOARD_MAT_MIN_VALUE_STEP);
    }
  });

  it("should measure the shipping inks, not the accents", () => {
    // The accents are the palette's loud colours; a mat is a desaturated tint,
    // so no mat is its own accent, and the two are never the same value.
    for (const mat of SUITE_BOARD_MATS) {
      expect(boardMatDistance(mat.ink, mat.ink)).toBe(0);
    }
    expect(SUITE_DESK_MAT.light.ground).toHaveLength(3);
  });
});
