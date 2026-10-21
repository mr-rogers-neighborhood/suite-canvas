import type { Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  cardSectionOffsets,
  sectionExpandPlan,
  sectionOffsets,
  sectionsExpandPlan,
} from "./sectionLayout";

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

describe("sectionsExpandPlan", () => {
  const card = (x: number, y: number, width = 224, height = 160) => ({ x, y, width, height });

  it("grows one section once for two cards dropped inside it", () => {
    const region = section("region", 0, 0, 320, 240);
    const plan = sectionsExpandPlan([region], [card(40, 40), card(260, 180)]);

    expect(plan).toHaveLength(1);
    const grown = plan[0];
    expect(grown?.id).toBe("region");
    // Both drops fit, not just the last one.
    expect(grown?.x).toBeLessThanOrEqual(40);
    expect(grown?.y).toBeLessThanOrEqual(40);
    expect((grown?.x ?? 0) + (grown?.width ?? 0)).toBeGreaterThanOrEqual(260 + 224);
    expect((grown?.y ?? 0) + (grown?.height ?? 0)).toBeGreaterThanOrEqual(180 + 160);
  });

  it("leaves a card that already fits out of the plan", () => {
    const region = section("region", 0, 0, 500, 400);
    expect(sectionsExpandPlan([region], [card(40, 40)])).toEqual([]);
  });

  it("plans one rect per section when cards land in different sections", () => {
    const left = section("left", 0, 0, 300, 300);
    const right = section("right", 400, 0, 300, 300);
    const plan = sectionsExpandPlan([left, right], [card(220, 250), card(620, 250)]);

    expect(plan.map((entry) => entry.id).sort()).toEqual(["left", "right"]);
    expect(plan.find((entry) => entry.id === "left")?.width).toBeGreaterThan(300);
    expect(plan.find((entry) => entry.id === "left")?.width).toBeLessThan(600);
  });

  it("grows every ancestor of the section that holds the card", () => {
    const outer = section("outer", 0, 0, 900, 700);
    const inner = section("inner", 50, 50, 400, 300);
    const plan = sectionsExpandPlan([outer, inner], [card(300, 200)]);

    expect(plan.map((entry) => entry.id)).toEqual(["inner", "outer"]);
    const innerRect = plan.find((entry) => entry.id === "inner");
    const outerRect = plan.find((entry) => entry.id === "outer");
    expect(innerRect).toBeDefined();
    expect(outerRect).toBeDefined();

    const contains = (rect: typeof outerRect, target: typeof innerRect) =>
      rect !== undefined &&
      target !== undefined &&
      target.x >= rect.x &&
      target.y >= rect.y &&
      target.x + target.width <= rect.x + rect.width &&
      target.y + target.height <= rect.y + rect.height;
    expect(contains(outerRect, innerRect)).toBe(true);
  });

  it("returns nothing when no card is inside a section", () => {
    const region = section("region", 0, 0, 200, 200);
    expect(sectionsExpandPlan([region], [card(900, 900)])).toEqual([]);
    expect(sectionsExpandPlan([], [card(10, 10)])).toEqual([]);
    expect(sectionsExpandPlan([region], [])).toEqual([]);
  });

  it("matches the single-card plan for one dropped card", () => {
    const outer = section("outer", 0, 0, 500, 400);
    const inner = section("inner", 50, 50, 300, 250);
    const single = sectionExpandPlan(
      [outer, inner],
      { x: 300, y: 100 },
      { width: 224, height: 160 },
    );
    const multi = sectionsExpandPlan([outer, inner], [card(300, 100)]);

    expect(multi).toEqual(single);
  });
});
