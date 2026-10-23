import { describe, expect, it } from "vitest";
import {
  CARD_BASE_EXTENT,
  cardTypeForScale,
  isSuiteCardType,
  SUITE_CARD_TYPES,
  SUITE_TYPE_LADDER,
  scaleForExtent,
} from "./suiteCardScale";

describe("suiteCardScale", () => {
  it("keeps the base rung on the bare type so existing placements stay valid", () => {
    expect(cardTypeForScale(1)).toBe("suite.card");
    expect(cardTypeForScale(2)).toBe("suite.card@2");
    expect(SUITE_CARD_TYPES).toEqual(SUITE_TYPE_LADDER.map(cardTypeForScale));
  });

  it("recognises its own rungs and nothing else", () => {
    expect(isSuiteCardType("suite.card")).toBe(true);
    expect(isSuiteCardType("suite.card@2")).toBe(true);
    expect(isSuiteCardType("suite.pin")).toBe(false);
    expect(isSuiteCardType("desk.note")).toBe(false);
    expect(isSuiteCardType(undefined)).toBe(false);
  });

  it("takes the rung the card's extent has room for, snapping down", () => {
    const base = { ...CARD_BASE_EXTENT };
    expect(scaleForExtent(base)).toBe(1);
    // Half size is still rung 1: the type never shrinks below the base hand.
    expect(scaleForExtent({ width: base.width / 2, height: base.height / 2 })).toBe(1);
    // 1.9x has not earned the 2x hand yet.
    expect(scaleForExtent({ width: base.width * 1.9, height: base.height * 1.9 })).toBe(1);
    // Twice either way is rung 2 — a wide card is as much a page as a tall one.
    expect(scaleForExtent({ width: base.width * 2, height: base.height })).toBe(2);
    expect(scaleForExtent({ width: base.width, height: base.height * 2 })).toBe(2);
    // Beyond the ladder stays on its top rung rather than inventing one.
    expect(scaleForExtent({ width: base.width * 8, height: base.height * 8 })).toBe(
      SUITE_TYPE_LADDER.at(-1),
    );
  });

  it("treats a missing or nonsensical extent as the base card", () => {
    expect(scaleForExtent({})).toBe(1);
    expect(scaleForExtent({ width: Number.NaN, height: Number.NaN })).toBe(1);
    expect(scaleForExtent({ width: Number.POSITIVE_INFINITY })).toBe(1);
  });
});
