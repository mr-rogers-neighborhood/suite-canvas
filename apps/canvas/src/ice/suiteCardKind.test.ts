import { describe, expect, it } from "vitest";
import { SUITE_CARD_KIND, SUITE_CARD_TYPE, SuiteCard, suiteCardWrite } from "./suiteCardKind";

/**
 * The kind's declared surface, without a desk: the props a projection writes
 * and the face group that carries them to the overlay. Anything that changes
 * here changes what `faceOf` can hand a slot renderer.
 */
describe("suite.card kind", () => {
  it("should expose the same type and kind name", () => {
    expect(SuiteCard.type).toBe(SUITE_CARD_TYPE);
    // The ground registers the paper program under this name, so they agree.
    expect(SUITE_CARD_KIND).toBe(SUITE_CARD_TYPE);
  });

  it("should carry the workspace card's coordinates on the face group", () => {
    expect(SuiteCard.propToGroup).toMatchObject({
      title: "face",
      body: "face",
      cardId: "face",
      boardId: "face",
    });
    const face = SuiteCard.groups.find((group) => group.name === "face");
    expect(face).toBeDefined();
  });
});

/**
 * The band contract on the writing (ADR-0043 §2): one flow reaches the paper,
 * and the kind is the door that decides how much of it this frame writes. The
 * card's *own* width on screen is what bands it, so a card resized on the desk
 * bands itself and a neighbour at another size is unaffected.
 */
describe("suite.card writing", () => {
  const flow = "▣ · A title · ⇄3 · #2\n\nThe body, which only the full band writes.";

  it("should write nothing below the compact width", () => {
    // Rung 1 is 288 world units wide: 55 px on screen is still a glyph by design.
    expect(suiteCardWrite(flow, 55)).toBe("");
  });

  it("should write the title row between the compact and full widths", () => {
    expect(suiteCardWrite(flow, 56)).toBe("▣ · A title · ⇄3 · #2");
    expect(suiteCardWrite(flow, 179)).toBe("▣ · A title · ⇄3 · #2");
  });

  it("should write the whole flow from the full width up", () => {
    expect(suiteCardWrite(flow, 180)).toBe(flow);
    expect(suiteCardWrite(flow, 288)).toBe(flow);
  });
});
