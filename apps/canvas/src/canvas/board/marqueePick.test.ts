import { describe, expect, it } from "vitest";
import { pickMarqueeSelection } from "./marqueePick";

const ALL = { cards: true, links: true, sections: true };
const SECTIONS_ONLY = { cards: false, links: false, sections: true };
const NOTHING_TOUCHED = { cardIds: [], linkIds: [], touchedSections: [] };

describe("what a finished selection box picks up", () => {
  it("takes the cards it caught", () => {
    const picked = pickMarqueeSelection(ALL, {
      ...NOTHING_TOUCHED,
      cardIds: ["a", "b"],
    });
    expect(picked).toEqual({
      cardIds: ["a", "b"],
      linkIds: [],
      sectionIds: [],
      sectionAlone: false,
    });
  });

  it("takes the links it crossed, whichever kind they are", () => {
    const picked = pickMarqueeSelection(ALL, {
      ...NOTHING_TOUCHED,
      linkIds: ["edge-1", "section-line-1"],
    });
    expect(picked.linkIds).toEqual(["edge-1", "section-line-1"]);
    expect(picked.cardIds).toEqual([]);
  });

  it("drops what the reader switched off", () => {
    const picked = pickMarqueeSelection(
      { cards: false, links: true, sections: false },
      { cardIds: ["a"], linkIds: ["edge-1"], touchedSections: [{ id: "s1", area: 100 }] },
    );
    expect(picked).toEqual({
      cardIds: [],
      linkIds: ["edge-1"],
      sectionIds: [],
      sectionAlone: false,
    });
  });

  /**
   * The reason the section is additive: a box over a section nearly always catches its cards
   * too, so a rule that only took the frame when the box caught nothing else would make the
   * sections toggle look dead.
   */
  it("adds the section to the cards it caught, rather than trading one for the other", () => {
    const picked = pickMarqueeSelection(ALL, {
      cardIds: ["a", "b"],
      linkIds: [],
      touchedSections: [{ id: "s1", area: 10_000 }],
    });
    expect(picked.cardIds).toEqual(["a", "b"]);
    expect(picked.sectionIds).toEqual(["s1"]);
    // Cards keep the panel: the frame is drawn around them, not opened.
    expect(picked.sectionAlone).toBe(false);
  });

  it("gives the panel to the section when the box caught nothing else", () => {
    const picked = pickMarqueeSelection(ALL, {
      ...NOTHING_TOUCHED,
      touchedSections: [{ id: "s1", area: 10_000 }],
    });
    expect(picked).toEqual({ cardIds: [], linkIds: [], sectionIds: ["s1"], sectionAlone: true });
  });

  it("takes every nested frame the box crossed, innermost last", () => {
    const picked = pickMarqueeSelection(ALL, {
      ...NOTHING_TOUCHED,
      // Document order puts the outer frame last; the small one is where the box was drawn.
      touchedSections: [
        { id: "inner", area: 4_000 },
        { id: "outer", area: 40_000 },
      ],
    });
    expect(picked.sectionIds).toEqual(["outer", "inner"]);
  });

  it("picks nothing at all from a box that crossed nothing", () => {
    expect(pickMarqueeSelection(ALL, NOTHING_TOUCHED)).toEqual({
      cardIds: [],
      linkIds: [],
      sectionIds: [],
      sectionAlone: false,
    });
  });

  it("still takes the section when sections are the only subject on", () => {
    const picked = pickMarqueeSelection(SECTIONS_ONLY, {
      ...NOTHING_TOUCHED,
      touchedSections: [{ id: "s1", area: 1 }],
    });
    expect(picked.sectionIds).toEqual(["s1"]);
    expect(picked.sectionAlone).toBe(true);
  });
});
