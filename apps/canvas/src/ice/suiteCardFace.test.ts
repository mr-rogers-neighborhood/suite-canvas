import { describe, expect, it } from "vitest";
import {
  CARD_FACE_REFERENCES_MARK,
  CARD_FACE_STROKES_MARK,
  CARD_FACE_TAGS_MARK,
  cardFaceAtBand,
  cardFaceBand,
  cardFaceFlow,
  cardFaceOf,
  cardFaceRevision,
  cardFaceRevisionOf,
  cardFaceTitle,
  cardFaceTitleRow,
  publishCardFaces,
  type SuiteCardFaceContent,
} from "./suiteCardFace";

const content = (overrides: Partial<SuiteCardFaceContent> = {}): SuiteCardFaceContent => ({
  glyph: "▣",
  title: "Capture first, sort later",
  references: 0,
  tags: 0,
  body: "",
  ...overrides,
});

describe("cardFaceTitleRow", () => {
  it("should read glyph, title and counts", () => {
    const row = cardFaceTitleRow(content({ references: 3, tags: 2 }));
    expect(row).toBe(
      `▣ · Capture first, sort later · ${CARD_FACE_REFERENCES_MARK}3 · ${CARD_FACE_TAGS_MARK}2`,
    );
  });

  it("should omit a count of zero instead of spending the line on it", () => {
    expect(cardFaceTitleRow(content({ references: 0, tags: 4 }))).toBe(
      `▣ · Capture first, sort later · ${CARD_FACE_TAGS_MARK}4`,
    );
    expect(cardFaceTitleRow(content({ references: 2, tags: 0 }))).toBe(
      `▣ · Capture first, sort later · ${CARD_FACE_REFERENCES_MARK}2`,
    );
    expect(cardFaceTitleRow(content())).toBe("▣ · Capture first, sort later");
  });

  it("should print a whiteboard's stroke count after its title", () => {
    expect(cardFaceTitleRow(content({ glyph: "▧", title: "Sketch", strokes: 4 }))).toBe(
      `▧ · Sketch · ${CARD_FACE_STROKES_MARK}4`,
    );
    // Zero strokes is nothing drawn, which is not worth a mark.
    expect(cardFaceTitleRow(content({ glyph: "▧", title: "Sketch", strokes: 0 }))).toBe(
      "▧ · Sketch",
    );
  });

  it("should survive a card with no glyph and no title", () => {
    expect(cardFaceTitleRow(content({ glyph: " ", title: " " }))).toBe("");
  });
});

describe("cardFaceFlow", () => {
  it("should put the body on its own paragraph under the title row", () => {
    expect(cardFaceFlow(content({ body: "Drop a thought first." }))).toBe(
      "▣ · Capture first, sort later\n\nDrop a thought first.",
    );
  });

  it("should be the title row alone when there is no body", () => {
    expect(cardFaceFlow(content({ body: "   " }))).toBe("▣ · Capture first, sort later");
  });

  it("should keep a multi-line body, which is how a whiteboard's sketch travels", () => {
    expect(
      cardFaceFlow(content({ glyph: "▧", title: "Sketch", strokes: 4, body: "▁█▁\n███" })),
    ).toBe(`▧ · Sketch · ${CARD_FACE_STROKES_MARK}4\n\n▁█▁\n███`);
  });
});

describe("cardFaceAtBand", () => {
  const flow = "▣ · A title · ⇄2\n\nThe body of the card.";

  it("should draw nothing at the icon band", () => {
    expect(cardFaceAtBand(flow, "icon")).toBe("");
  });

  it("should draw the title row alone at the compact band", () => {
    expect(cardFaceAtBand(flow, "compact")).toBe("▣ · A title · ⇄2");
  });

  it("should draw the title row and the body at the full band", () => {
    expect(cardFaceAtBand(flow, "full")).toBe(flow);
  });
});

describe("cardFaceBand", () => {
  it("should change at the thresholds the ADR names", () => {
    expect(cardFaceBand(55.9)).toBe("icon");
    expect(cardFaceBand(56)).toBe("compact");
    expect(cardFaceBand(179.9)).toBe("compact");
    expect(cardFaceBand(180)).toBe("full");
  });

  it("should treat a width it cannot use as the smallest band", () => {
    expect(cardFaceBand(Number.NaN)).toBe("icon");
    expect(cardFaceBand(-10)).toBe("icon");
  });
});

describe("cardFaceTitle", () => {
  it("should keep a card's own title", () => {
    expect(cardFaceTitle("Weekly review", "Note")).toBe("Weekly review");
  });

  it("should name the type when the card has neither a title nor a body", () => {
    // `displayTitle` answers "Untitled" for a whiteboard, whose content is its drawing.
    expect(cardFaceTitle("Untitled", "Whiteboard")).toBe("Whiteboard");
    expect(cardFaceTitle("", "Note")).toBe("Note");
  });
});

describe("the published faces", () => {
  it("should answer what the projection last wrote", () => {
    expect(cardFaceOf("card-1")).toBeUndefined();
    publishCardFaces(new Map([["card-1", "▣ · One"]]));
    expect(cardFaceOf("card-1")).toBe("▣ · One");
    // A card that left the View publishes nothing, so a stale face cannot linger.
    publishCardFaces(new Map());
    expect(cardFaceOf("card-1")).toBeUndefined();
  });

  it("should give a flow a revision that changes when its words do", () => {
    const one = cardFaceRevision("▣ · One · #1");
    expect(one).toBe(cardFaceRevision("▣ · One · #1"));
    expect(one).not.toBe(cardFaceRevision("▣ · One · #2"));
    expect(one).not.toBe(cardFaceRevision("▣ · Two · #1"));
    // The rung multiplies a revision by four, so it has to stay 16 bits.
    expect(one).toBeGreaterThanOrEqual(0);
    expect(one).toBeLessThan(0x10000);
  });

  it("should not change a revision for an unrelated card's edit", () => {
    publishCardFaces(
      new Map([
        ["card-1", "▣ · One"],
        ["card-2", "▣ · Two"],
      ]),
    );
    const before = cardFaceRevisionOf("card-1");
    publishCardFaces(
      new Map([
        ["card-1", "▣ · One"],
        ["card-2", "▣ · Two · #3"],
      ]),
    );
    expect(cardFaceRevisionOf("card-1")).toBe(before);
    expect(cardFaceRevisionOf("card-2")).not.toBe(before);
  });
});
