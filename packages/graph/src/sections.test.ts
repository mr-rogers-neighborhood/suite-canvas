import { describe, expect, it } from "vitest";
import type { Placement, Section } from "./schema.js";
import {
  cardAnchor,
  sectionForCard,
  sectionLineage,
  sectionMembership,
  sectionMovePlan,
  sectionsAt,
  unionRect,
} from "./sections.js";

function section(id: string, x: number, y: number, width: number, height: number): Section {
  return {
    id,
    boardId: "board-1",
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

function placement(cardId: string, x: number, y: number): Placement {
  return { boardId: "board-1", cardId, x, y, z: 0, createdAt: 0 };
}

describe("sections geometry", () => {
  it("uses the card header anchor, not its center", () => {
    expect(cardAnchor({ x: 10, y: 20 })).toEqual({ x: 18, y: 28 });
  });

  it("picks the smallest containing section", () => {
    const outer = section("outer", 0, 0, 800, 600);
    const inner = section("inner", 100, 100, 300, 300);
    const point = { x: 150, y: 150 };

    expect(sectionsAt(point, [outer, inner]).map((entry) => entry.id)).toEqual(["inner", "outer"]);
  });

  it("derives nesting by full containment", () => {
    const outer = section("outer", 0, 0, 800, 600);
    const inner = section("inner", 100, 100, 300, 300);
    const partial = section("partial", 600, 400, 300, 300);

    expect(sectionLineage("outer", [outer, inner, partial]).map((entry) => entry.id)).toEqual([
      "outer",
      "inner",
    ]);
  });

  it("assigns each card to its smallest section", () => {
    const outer = section("outer", 0, 0, 800, 600);
    const inner = section("inner", 100, 100, 300, 300);
    const outside = section("outside", 1000, 1000, 100, 100);
    const placements = [
      placement("a", 150, 150),
      placement("b", 500, 500),
      placement("c", 1000, 1000),
    ];

    expect([...sectionMembership(placements, [outer, inner, outside])]).toEqual([
      ["a", "inner"],
      ["b", "outer"],
      ["c", "outside"],
    ]);
    expect(sectionForCard({ x: 1000, y: 1000 }, [outer, inner, outside])?.id).toBe("outside");
  });

  it("moves nested sections and their members together", () => {
    const outer = section("outer", 0, 0, 800, 600);
    const inner = section("inner", 100, 100, 300, 300);
    const other = section("other", 1000, 0, 200, 200);
    const placements = [
      placement("a", 150, 150),
      placement("b", 500, 500),
      placement("c", 1100, 100),
    ];

    const plan = sectionMovePlan("outer", [outer, inner, other], placements);

    expect(plan.sections.map((entry) => entry.id)).toEqual(["outer", "inner"]);
    expect(plan.placements.map((entry) => entry.cardId)).toEqual(["a", "b"]);
  });

  it("does not include a partially overlapping section", () => {
    const a = section("a", 0, 0, 300, 300);
    const b = section("b", 200, 200, 300, 300);

    expect(sectionMovePlan("a", [a, b], []).sections.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("unions rectangles with padding", () => {
    expect(
      unionRect(
        { x: 0, y: 0, width: 10, height: 10 },
        [{ x: 20, y: 20, width: 10, height: 10 }],
        2,
      ),
    ).toEqual({
      x: -2,
      y: -2,
      width: 34,
      height: 34,
    });
  });
});
