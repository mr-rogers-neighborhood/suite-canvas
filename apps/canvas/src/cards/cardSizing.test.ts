import { describe, expect, it } from "vitest";
import { AUTO_CARD_MIN_HEIGHT, cardSizing } from "./cardSizing";

/**
 * How tall a card is.
 *
 * Pulled out of `NodeCard` because the decision is three facts and two answers, and because it is the rule that decides
 * whether a board of these cards keeps the shared default box or takes each one's own height.
 */
const FALLBACK = 240;

function size(patch: Partial<Parameters<typeof cardSizing>[0]> = {}) {
  return cardSizing(
    { hasPassage: true, height: null, collapsed: false, bodyText: "", ...patch },
    FALLBACK,
  );
}

describe("sizing a card", () => {
  it("should let the passage decide while nobody has resized it", () => {
    expect(size().autoHeight).toBe(true);
    expect(size().heightStyle).toEqual({ height: "auto", minHeight: AUTO_CARD_MIN_HEIGHT });
  });

  it("should obey a height the reader chose", () => {
    expect(size({ height: 320 }).heightStyle).toEqual({ height: 320 });
    expect(size({ height: 320 }).autoHeight).toBe(false);
  });

  it("should keep the shared default for a card with no passage", () => {
    expect(size({ hasPassage: false }).heightStyle).toEqual({ height: FALLBACK });
  });

  it("should fold to its header line whatever the passage needs", () => {
    // A fold is a reading state: the stored height is what unfolds it, so `auto` must not win here.
    expect(size({ collapsed: true }).heightStyle).toEqual({ height: FALLBACK });
  });

  it("should not let an empty body claim the rest of the card", () => {
    expect(size().bodyClass).toBe("flex-none");
    expect(size({ bodyText: "   " }).bodyClass).toBe("flex-none");
  });

  it("should give the body its room once there is writing, or once the card is a size the reader chose", () => {
    expect(size({ bodyText: "A comment." }).bodyClass).toBe("flex-1");
    expect(size({ height: 320 }).bodyClass).toBe("flex-1");
  });
});
