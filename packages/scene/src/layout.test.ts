import { describe, expect, it } from "vitest";
import type { FractalRecipe, LayoutItem } from "./layout.js";
import {
  arrangeItems,
  DEFAULT_FRACTAL_RECIPE,
  LAYOUT_PATTERNS,
  overlappingPlacements,
  planFractalLayout,
} from "./layout.js";

const cards = (count: number): LayoutItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `card-${index}`,
    width: 100,
    height: 80,
  }));

const recipe = (overrides: Partial<FractalRecipe> = {}): FractalRecipe => ({
  ...DEFAULT_FRACTAL_RECIPE,
  gap: 20,
  padding: 0,
  ...overrides,
});

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

describe("arrangeItems", () => {
  for (const pattern of LAYOUT_PATTERNS) {
    it(`should place six cards without overlaps in a ${pattern}`, () => {
      const placements = arrangeItems(cards(6), pattern, { gap: 20 });
      expect(placements).toHaveLength(6);
      expect(overlappingPlacements(placements)).toEqual([]);
      expect(new Set(placements.map((placement) => placement.id)).size).toBe(6);
    });
  }

  it("should be deterministic", () => {
    const first = arrangeItems(cards(5), "phyllotaxis", { gap: 20, seed: 3 });
    const second = arrangeItems(cards(5), "phyllotaxis", { gap: 20, seed: 3 });
    expect(first).toEqual(second);
  });

  it("should apply seeded jitter deterministically", () => {
    const first = arrangeItems(cards(4), "grid", { gap: 20, jitter: 10, seed: 7 });
    const second = arrangeItems(cards(4), "grid", { gap: 20, jitter: 10, seed: 7 });
    const other = arrangeItems(cards(4), "grid", { gap: 20, jitter: 10, seed: 8 });
    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
  });

  it("should keep pinned items and skip excluded items", () => {
    const items: LayoutItem[] = [
      { id: "pinned", width: 100, height: 80, pinned: true, x: 500, y: 600 },
      { id: "excluded", width: 100, height: 80, excluded: true },
      { id: "flow", width: 100, height: 80 },
    ];
    const placements = arrangeItems(items, "grid", { gap: 20 });
    expect(placements.map((placement) => placement.id).sort()).toEqual(["flow", "pinned"]);
    expect(defined(placements.find((placement) => placement.id === "pinned"))).toMatchObject({
      x: 500,
      y: 600,
      width: 100,
      height: 80,
    });
  });

  it("should honour the reading order", () => {
    const items: LayoutItem[] = [
      { id: "bottom", width: 100, height: 80, x: 0, y: 200 },
      { id: "top", width: 100, height: 80, x: 0, y: 0 },
    ];
    const placements = arrangeItems(items, "grid", { gap: 20, order: "reading" });
    expect(placements.map((placement) => placement.id)).toEqual(["top", "bottom"]);
  });

  it("should rotate placements at deeper levels", () => {
    const placements = arrangeItems(cards(2), "grid", { rotate: 0.25, depth: 2 });
    expect(placements.every((placement) => placement.rotate === 0.25)).toBe(true);
    expect(placements.every((placement) => placement.depth === 2)).toBe(true);
  });
});

describe("planFractalLayout", () => {
  it("should lay out the root board and recurse through portals", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: {
        a: [
          { id: "p", width: 300, height: 200, portalBoardId: "b" },
          { id: "n", width: 100, height: 80 },
        ],
        b: [
          { id: "x", width: 100, height: 80 },
          { id: "y", width: 100, height: 80 },
        ],
      },
      recipe: recipe({ depth: { scale: 0.5, gap: 5, rotate: 0.1 } }),
    });
    expect(plan.boardId).toBe("a");
    expect(plan.pattern).toBe("grid");
    expect(plan.issues).toEqual([]);
    expect(overlappingPlacements(plan.placements)).toEqual([]);
    const portal = defined(plan.portals[0]);
    expect(portal.targetBoardId).toBe("b");
    expect(portal.cycle).toBe(false);
    expect(portal.depthCapped).toBe(false);
    const child = defined(portal.child);
    expect(child.boardId).toBe("b");
    expect(child.depth).toBe(1);
    expect(child.placements).toHaveLength(2);
    expect(child.placements.every((placement) => placement.rotate === 0.1)).toBe(true);
    expect(portal.frame.width).toBeCloseTo(defined(child.bounds).width * 0.5);
    expect(portal.frame.height).toBeCloseTo(defined(child.bounds).height * 0.5);
  });

  it("should honour the per-depth pattern override", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: {
        a: [{ id: "p", width: 300, height: 200, portalBoardId: "b" }],
        b: cards(3),
      },
      recipe: recipe({ pattern: "grid", depth: { scale: 1, gap: 10, rotate: 0, pattern: "rows" } }),
    });
    expect(plan.pattern).toBe("grid");
    expect(defined(plan.portals[0]).child?.pattern).toBe("rows");
  });

  it("should stop recursion at a cycle", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: {
        a: [{ id: "p", width: 300, height: 200, portalBoardId: "b" }],
        b: [{ id: "q", width: 300, height: 200, portalBoardId: "a" }],
      },
      recipe: recipe(),
    });
    const child = defined(defined(plan.portals[0]).child);
    const back = defined(child.portals[0]);
    expect(back.cycle).toBe(true);
    expect(back.child).toBeNull();
    expect(child.issues.some((issue) => issue.code === "cycle")).toBe(true);
  });

  it("should stop recursion at the depth cap", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: {
        a: [{ id: "p", width: 300, height: 200, portalBoardId: "b" }],
        b: [{ id: "q", width: 300, height: 200, portalBoardId: "c" }],
        c: cards(2),
      },
      recipe: recipe(),
      maxDepth: 1,
    });
    expect(defined(plan.portals[0]).child).not.toBeNull();
    const capped = defined(defined(defined(plan.portals[0]).child).portals[0]);
    expect(capped.depthCapped).toBe(true);
    expect(capped.child).toBeNull();
  });

  it("should report a portal whose target board is missing", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: { a: [{ id: "p", width: 300, height: 200, portalBoardId: "ghost" }] },
      recipe: recipe(),
    });
    const portal = defined(plan.portals[0]);
    expect(portal.missing).toBe(true);
    expect(portal.child).toBeNull();
    expect(plan.issues.map((issue) => issue.code)).toContain("missing-board");
  });

  it("should report overlaps between pinned and flow placements", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: {
        a: [
          { id: "pinned", width: 100, height: 80, pinned: true, x: 0, y: 0 },
          { id: "flow", width: 100, height: 80 },
        ],
      },
      recipe: recipe({ padding: 0 }),
    });
    expect(plan.issues.some((issue) => issue.code === "overlap")).toBe(true);
  });

  it("should never mutate its input", () => {
    const boards = {
      a: [
        { id: "p", width: 300, height: 200, portalBoardId: "b" },
        { id: "n", width: 100, height: 80 },
      ],
      b: cards(2),
    };
    const before = JSON.stringify({ boards, recipe: recipe() });
    planFractalLayout({ rootBoardId: "a", boards, recipe: recipe() });
    expect(JSON.stringify({ boards, recipe: recipe() })).toBe(before);
  });

  it("should be deterministic for the same input", () => {
    const input = {
      rootBoardId: "a",
      boards: { a: cards(6) },
      recipe: recipe({ pattern: "treemap" as const, jitter: 5, seed: 11 }),
    };
    expect(planFractalLayout(input)).toEqual(planFractalLayout(input));
  });
});
