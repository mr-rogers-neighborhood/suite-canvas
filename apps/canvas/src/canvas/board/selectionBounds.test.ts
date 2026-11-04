import { describe, expect, it } from "vitest";
import { describeExtent, selectionExtent, unionOfRects } from "./selectionBounds";

const NONE = { cards: [], sections: [], links: [] };
const COUNT = { cards: 0, sections: 0, links: 0 };

describe("the box around a selection", () => {
  it("is nothing when nothing is selected", () => {
    expect(unionOfRects([])).toBeNull();
    expect(selectionExtent(NONE, COUNT).rect).toBeNull();
  });

  it("is the one rect when one thing is selected", () => {
    expect(unionOfRects([{ x: 10, y: 20, width: 100, height: 50 }])).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  /** The report: a box around cards said nothing about the frame they sat in. */
  it("wraps a frame and the cards inside it, not only the cards", () => {
    const extent = selectionExtent(
      {
        cards: [{ x: 100, y: 100, width: 200, height: 120 }],
        sections: [{ x: 0, y: 0, width: 800, height: 600 }],
        links: [],
      },
      { cards: 1, sections: 1, links: 0 },
    );
    expect(extent.rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("wraps two frames that do not touch", () => {
    const extent = selectionExtent(
      {
        cards: [],
        sections: [
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 400, y: 300, width: 100, height: 100 },
        ],
        links: [],
      },
      { cards: 0, sections: 2, links: 0 },
    );
    expect(extent.rect).toEqual({ x: 0, y: 0, width: 500, height: 400 });
  });

  it("counts what a link contributes, so a link-only selection still has a box", () => {
    const extent = selectionExtent(
      {
        cards: [],
        sections: [],
        links: [
          { x: 10, y: 10, width: 0, height: 0 },
          { x: 210, y: 110, width: 0, height: 0 },
        ],
      },
      { cards: 0, sections: 0, links: 1 },
    );
    expect(extent.rect).toEqual({ x: 10, y: 10, width: 200, height: 100 });
  });

  it("skips a rect a measurement failed for rather than losing the whole box", () => {
    const rect = unionOfRects([
      { x: 5, y: 5, width: 50, height: 50 },
      { x: Number.NaN, y: 0, width: 10, height: 10 },
    ]);
    expect(rect).toEqual({ x: 5, y: 5, width: 50, height: 50 });
  });
});

describe("the words beside the box", () => {
  it("names each kind it holds, in reading order", () => {
    expect(describeExtent({ cards: 3, sections: 2, links: 0 })).toBe("3 cards · 2 sections");
    expect(describeExtent({ cards: 1, sections: 1, links: 1 })).toBe("1 card · 1 section · 1 link");
  });

  it("says nothing for an empty selection", () => {
    expect(describeExtent(COUNT)).toBe("");
  });
});
