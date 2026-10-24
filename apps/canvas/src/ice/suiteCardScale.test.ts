import { describe, expect, it } from "vitest";
import {
  CARD_BASE_EXTENT,
  CARD_BASE_SCALE,
  cardScaleForResize,
  cardTypeForScale,
  clampCardTypeScale,
  isCardTypeScale,
  isSuiteCardType,
  MAX_CARD_TYPE_SCALE,
  MIN_CARD_TYPE_SCALE,
  SUITE_CARD_TYPES,
  SUITE_TYPE_LADDER,
  scaleForExtent,
} from "./suiteCardScale";

describe("suiteCardScale", () => {
  it("should keep the base rung on the bare type so existing placements stay valid", () => {
    expect(CARD_BASE_SCALE).toBe(1);
    expect(cardTypeForScale(1)).toBe("suite.card");
    expect(cardTypeForScale(0.5)).toBe("suite.card@0.5");
    expect(cardTypeForScale(2)).toBe("suite.card@2");
    expect(cardTypeForScale(3)).toBe("suite.card@3");
    expect(SUITE_CARD_TYPES).toEqual(SUITE_TYPE_LADDER.map(cardTypeForScale));
  });

  it("should read its floor and cap from the ladder, never hard-code them", () => {
    expect(MIN_CARD_TYPE_SCALE).toBe(SUITE_TYPE_LADDER[0]);
    expect(MAX_CARD_TYPE_SCALE).toBe(SUITE_TYPE_LADDER[SUITE_TYPE_LADDER.length - 1]);
    // The locked shape is 0.5 · 1 · 2 · 3; whatever the ladder holds, the
    // policies below clamp to its ends rather than to a constant of their own.
    expect(SUITE_TYPE_LADDER).toContain(CARD_BASE_SCALE);
    expect(cardTypeForScale(MIN_CARD_TYPE_SCALE)).toBe(
      MIN_CARD_TYPE_SCALE === 1 ? "suite.card" : `suite.card@${MIN_CARD_TYPE_SCALE}`,
    );
    expect(cardTypeForScale(MAX_CARD_TYPE_SCALE)).toBe(`suite.card@${MAX_CARD_TYPE_SCALE}`);
  });

  it("should recognise its own rungs and nothing else", () => {
    for (const rung of SUITE_TYPE_LADDER) expect(isCardTypeScale(rung)).toBe(true);
    expect(isCardTypeScale(1.5)).toBe(false);
    expect(isSuiteCardType("suite.card")).toBe(true);
    expect(isSuiteCardType(cardTypeForScale(MAX_CARD_TYPE_SCALE))).toBe(true);
    expect(isSuiteCardType("suite.card@1.5")).toBe(false);
    expect(isSuiteCardType("suite.pin")).toBe(false);
    expect(isSuiteCardType("desk.note")).toBe(false);
    expect(isSuiteCardType(undefined)).toBe(false);
  });

  it("should take the rung the card's extent has room for, snapping down", () => {
    const base = { ...CARD_BASE_EXTENT };
    expect(scaleForExtent(base)).toBe(CARD_BASE_SCALE);
    // Half size drops to the floor: a smaller box takes a smaller hand.
    expect(scaleForExtent({ width: base.width / 2, height: base.height / 2 })).toBe(
      MIN_CARD_TYPE_SCALE,
    );
    // 1.9x has not earned the 2x hand yet.
    expect(scaleForExtent({ width: base.width * 1.9, height: base.height * 1.9 })).toBe(1);
    // Twice either way is rung 2 — a wide card is as much a page as a tall one.
    expect(scaleForExtent({ width: base.width * 2, height: base.height })).toBe(2);
    expect(scaleForExtent({ width: base.width, height: base.height * 2 })).toBe(2);
    // Past the top rung it stays on the cap.
    expect(scaleForExtent({ width: base.width * 3, height: base.height })).toBe(
      MAX_CARD_TYPE_SCALE,
    );
    // Beyond the ladder stays on its top rung rather than inventing one.
    expect(scaleForExtent({ width: base.width * 8, height: base.height * 8 })).toBe(
      MAX_CARD_TYPE_SCALE,
    );
    // Below the floor it bottoms out at the floor.
    expect(scaleForExtent({ width: 8, height: 8 })).toBe(MIN_CARD_TYPE_SCALE);
  });

  it("should treat a missing or nonsensical extent as the base card", () => {
    expect(scaleForExtent({})).toBe(1);
    expect(scaleForExtent({ width: Number.NaN, height: Number.NaN })).toBe(1);
    expect(scaleForExtent({ width: Number.POSITIVE_INFINITY })).toBe(1);
  });

  it("should clamp a hand into the ladder, rounding down", () => {
    expect(clampCardTypeScale(0.1)).toBe(MIN_CARD_TYPE_SCALE);
    expect(clampCardTypeScale(0.9)).toBe(MIN_CARD_TYPE_SCALE);
    expect(clampCardTypeScale(1)).toBe(1);
    expect(clampCardTypeScale(MAX_CARD_TYPE_SCALE + 0.7)).toBe(MAX_CARD_TYPE_SCALE);
    expect(clampCardTypeScale(99)).toBe(MAX_CARD_TYPE_SCALE);
    expect(clampCardTypeScale(Number.NaN)).toBe(CARD_BASE_SCALE);
  });

  it("should follow the box on a similarity resize", () => {
    const base = { ...CARD_BASE_EXTENT };
    // No reflow flag: the rung is the box's, through the projection's mapping.
    expect(cardScaleForResize({ extent: base })).toBe(1);
    expect(cardScaleForResize({ extent: { width: base.width * 2, height: base.height } })).toBe(2);
    expect(cardScaleForResize({ extent: { width: base.width * 4, height: base.height } })).toBe(
      MAX_CARD_TYPE_SCALE,
    );
    expect(cardScaleForResize({ extent: { width: 8, height: 8 } })).toBe(MIN_CARD_TYPE_SCALE);
    // A start rung does not sway the similarity reading.
    expect(
      cardScaleForResize({
        extent: { width: base.width * 2, height: base.height },
        startScale: 0.5,
      }),
    ).toBe(2);
  });

  it("should pin the start rung on a reflow resize", () => {
    const base = { ...CARD_BASE_EXTENT };
    expect(
      cardScaleForResize({
        extent: { width: base.width * 2, height: base.height },
        reflow: true,
        startScale: 1,
      }),
    ).toBe(1);
    expect(
      cardScaleForResize({ extent: { width: 8, height: 8 }, reflow: true, startScale: 1 }),
    ).toBe(1);
    // A pin outside the ladder is clamped into it, never invented.
    expect(
      cardScaleForResize({
        extent: { width: base.width * 2, height: base.height },
        reflow: true,
        startScale: 9,
      }),
    ).toBe(MAX_CARD_TYPE_SCALE);
    // With no start rung, reflow holds the rung the extent already has.
    expect(
      cardScaleForResize({
        extent: { width: base.width * 2, height: base.height },
        reflow: true,
      }),
    ).toBe(2);
  });
});
