import { describe, expect, it } from "vitest";
import { SUITE_CARD_KIND, SUITE_CARD_TYPE, SuiteCard } from "./suiteCardKind";

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
