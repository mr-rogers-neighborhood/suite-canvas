import type { Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { cardSectionOffsets, sectionExpandPlan, sectionOffsets } from "./sectionLayout";

function section(id: string, x: number, y: number, width: number, height: number): Section {
  return {
    id,
    boardId: "b1",
    title: id,
    x,
    y,
    width,
    height,
    z: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("sectionLayout", () => {
  it("offsets a dragged section and the sections inside it", () => {
    const outer = section("outer", 0, 0, 800, 600);
    const inner = section("inner", 100, 100, 300, 300);
    const other = section("other", 1000, 0, 100, 100);

    const offsets = sectionOffsets(
      [outer, inner, other],
      [{ sectionId: "outer", position: { x: 40, y: 30 } }],
    );

    expect(offsets.get("outer")).toEqual({ dx: 40, dy: 30 });
    expect(offsets.get("inner")).toEqual({ dx: 40, dy: 30 });
    expect(offsets.has("other")).toBe(false);
  });

  it("maps members of a moving section to the same card offset", () => {
    const offsets = new Map([["s1", { dx: 20, dy: 10 }]]);
    const cards = cardSectionOffsets(
      new Map([
        ["a", "s1"],
        ["b", "s2"],
      ]),
      offsets,
    );

    expect(cards.get("a")).toEqual({ dx: 20, dy: 10 });
    expect(cards.has("b")).toBe(false);
  });

  it("leaves a fully contained card alone when it is dropped", () => {
    const outer = section("outer", 0, 0, 800, 600);
    expect(sectionExpandPlan([outer], { x: 100, y: 100 }, { width: 200, height: 100 })).toBeNull();
  });

  it("expands the section and its ancestor to fit a hanging card", () => {
    const outer = section("outer", 0, 0, 500, 400);
    const inner = section("inner", 50, 50, 300, 250);
    const plan = sectionExpandPlan([outer, inner], { x: 300, y: 100 }, { width: 224, height: 160 });

    expect(plan?.map((entry) => entry.id).sort()).toEqual(["inner", "outer"]);
    const innerRect = plan?.find((entry) => entry.id === "inner");
    const outerRect = plan?.find((entry) => entry.id === "outer");
    expect(innerRect?.width).toBeGreaterThan(300);
    expect(outerRect?.width).toBeGreaterThanOrEqual(innerRect?.width ?? 0);
  });

  it("does not expand when the card is outside every section", () => {
    expect(
      sectionExpandPlan([section("outer", 0, 0, 100, 100)], { x: 500, y: 500 }, {}),
    ).toBeNull();
  });
});
