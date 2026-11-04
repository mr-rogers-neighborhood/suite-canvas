import { describe, expect, it } from "vitest";
import { colourPlan, colourPlanIsEmpty } from "./colour";

/**
 * One press colours every selected entity, so the plan is the whole set: a mixed selection
 * reaches all three fields, and a press on nothing reaches none. The swatch itself is not part
 * of the plan — clearing and colouring touch the same entities.
 */

const NONE = { nodeIds: [], edgeIds: [], sectionIds: [] };

describe("colourPlan", () => {
  it("reaches a lone card", () => {
    expect(colourPlan({ ...NONE, nodeIds: ["c1"] })).toEqual({
      cards: ["c1"],
      edges: [],
      sections: [],
    });
  });

  it("counts a portal as a card, because a portal is a card record", () => {
    expect(colourPlan({ ...NONE, nodeIds: ["door"] }).cards).toEqual(["door"]);
  });

  it("reaches a frame and a link in their own lists", () => {
    const plan = colourPlan({ ...NONE, edgeIds: ["e1"], sectionIds: ["s1"] });

    expect(plan).toEqual({ cards: [], edges: ["e1"], sections: ["s1"] });
  });

  it("reaches every kind of a mixed selection", () => {
    const plan = colourPlan({ nodeIds: ["c1", "c2"], edgeIds: ["e1"], sectionIds: ["s1"] });

    expect(plan).toEqual({ cards: ["c1", "c2"], edges: ["e1"], sections: ["s1"] });
    expect(colourPlanIsEmpty(plan)).toBe(false);
  });

  it("reaches nothing when nothing is selected", () => {
    expect(colourPlanIsEmpty(colourPlan(NONE))).toBe(true);
  });

  it("keeps the selection's order, so a bulk write is the order the reader picked", () => {
    expect(colourPlan({ ...NONE, nodeIds: ["b", "a"] }).cards).toEqual(["b", "a"]);
  });
});
