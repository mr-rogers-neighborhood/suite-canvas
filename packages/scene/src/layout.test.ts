import { describe, expect, it } from "vitest";
import type { FractalRecipe, LayoutItem, LayoutPlacement } from "./layout.js";
import {
  arrangeFractal,
  arrangeItems,
  clusterItems,
  DEFAULT_FRACTAL_RECIPE,
  DEFAULT_FRACTAL_SCALE_STEP,
  FRACTAL_SPIRAL_RECIPE,
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

describe("clusterItems", () => {
  it("should cut ordered items into contiguous runs of ceil(n / branching)", () => {
    const clusters = clusterItems(cards(12), { branching: 3, cluster: "order" });
    expect(clusters.map((cluster) => cluster.length)).toEqual([4, 4, 4]);
    expect(new Set(clusters.flat().map((item) => item.id)).size).toBe(12);
    const uneven = clusterItems(cards(10), { branching: 3, cluster: "order" });
    expect(uneven.map((cluster) => cluster.length)).toEqual([4, 4, 2]);
  });

  it("should group by type before folding groups into clusters", () => {
    const items = cards(12).map((card, index) => ({
      ...card,
      typeId: index < 5 ? "note" : index < 9 ? "quote" : "sketch",
    }));
    const clusters = clusterItems(items, { branching: 3, cluster: "type" });
    expect(clusters.map((cluster) => cluster.length)).toEqual([5, 4, 3]);
    expect(clusters.map((cluster) => cluster[0]?.typeId)).toEqual(["note", "quote", "sketch"]);
  });

  it("should group by the alphabetically first tag", () => {
    const items: LayoutItem[] = [
      { id: "a", width: 10, height: 10, tags: ["zeta", "alpha"] },
      { id: "b", width: 10, height: 10, tags: ["alpha", "beta"] },
      { id: "c", width: 10, height: 10, tags: ["zeta"] },
      { id: "d", width: 10, height: 10 },
    ];
    const clusters = clusterItems(items, { branching: 3, cluster: "tag" });
    expect(clusters.map((cluster) => cluster.map((item) => item.id))).toEqual([
      ["a", "b"],
      ["c"],
      ["d"],
    ]);
  });

  it("should keep a board that cannot fill a cluster whole", () => {
    const clusters = clusterItems(cards(3), { branching: 9, cluster: "order" });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });
});

describe("fractal arrangement", () => {
  const step = DEFAULT_FRACTAL_SCALE_STEP;

  const scalesOf = (placements: readonly LayoutPlacement[]): number[] => [
    ...new Set(placements.map((placement) => defined(placement.scale))),
  ];

  const countByScale = (placements: readonly LayoutPlacement[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const placement of placements) {
      const key = String(defined(placement.scale));
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };

  it("should reproduce the flat plan exactly when levels is 1", () => {
    const boards = { a: cards(12) };
    const flat = planFractalLayout({
      rootBoardId: "a",
      boards,
      recipe: recipe({ pattern: "spiral", jitter: 3, seed: 5 }),
    });
    const explicit = planFractalLayout({
      rootBoardId: "a",
      boards,
      recipe: recipe({ pattern: "spiral", jitter: 3, seed: 5, levels: 1 }),
    });
    expect(explicit).toStrictEqual(flat);
    expect("scale" in defined(explicit.placements[0])).toBe(false);
    expect("rung" in defined(explicit.placements[0])).toBe(false);
    expect(arrangeFractal(cards(5), "spiral", { gap: 20, levels: 1 })).toStrictEqual(
      arrangeItems(cards(5), "spiral", { gap: 20 }),
    );
  });

  it("should arrange twelve cards on three scales", () => {
    // 7 notes, 4 quotes and 1 sketch: the type groups split at three different
    // depths, so the plan genuinely shows three sizes rather than one.
    const items = cards(12).map((card, index) => ({
      ...card,
      typeId: index < 7 ? "note" : index < 11 ? "quote" : "sketch",
    }));
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: { a: items },
      recipe: recipe({
        pattern: "spiral",
        levels: 3,
        branching: 3,
        cluster: "type",
      }),
    });
    expect(plan.placements).toHaveLength(12);
    expect(scalesOf(plan.placements).sort()).toEqual([step * step, step, 1].sort());
    expect(countByScale(plan.placements)).toEqual({
      "1": 1,
      [String(step)]: 1,
      [String(step * step)]: 10,
    });
    // Deeper levels shrink the box, not just the offset.
    const widest = Math.max(...plan.placements.map((placement) => placement.width));
    const narrowest = Math.min(...plan.placements.map((placement) => placement.width));
    expect(widest).toBeCloseTo(100);
    expect(narrowest).toBeCloseTo(100 * step * step);
    for (const placement of plan.placements) {
      expect(defined(placement.scale)).toBeCloseTo(step ** (defined(placement.rung) - 1));
    }
  });

  for (const pattern of LAYOUT_PATTERNS) {
    it(`should not overlap placements inside or between ${pattern} clusters`, () => {
      const plan = planFractalLayout({
        rootBoardId: "a",
        boards: { a: cards(12) },
        recipe: recipe({ pattern, levels: 3, branching: 3, align: "center" }),
      });
      expect(plan.placements).toHaveLength(12);
      expect(overlappingPlacements(plan.placements)).toEqual([]);
      expect(plan.issues).toEqual([]);
    });
  }

  it("should be deterministic for the same fractal input", () => {
    const input = {
      rootBoardId: "a",
      boards: { a: cards(12) },
      recipe: recipe({ pattern: "phyllotaxis", levels: 3, branching: 4 }),
    };
    expect(planFractalLayout(input)).toStrictEqual(planFractalLayout(input));
  });

  it("should place a board with a single card at its own size", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: { a: cards(1) },
      recipe: FRACTAL_SPIRAL_RECIPE,
    });
    expect(plan.placements).toHaveLength(1);
    expect(defined(plan.placements[0])).toMatchObject({
      width: 100,
      height: 80,
      scale: 1,
      rung: 1,
    });
    expect(plan.issues).toEqual([]);
  });

  it("should not crash when branching exceeds the card count", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: { a: cards(3) },
      recipe: recipe({ pattern: "grid", levels: 3, branching: 9 }),
    });
    expect(plan.placements).toHaveLength(3);
    expect(overlappingPlacements(plan.placements)).toEqual([]);
  });

  it("should fractalize the spiral preset", () => {
    expect(FRACTAL_SPIRAL_RECIPE).toMatchObject({ pattern: "spiral", levels: 3, branching: 3 });
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: { a: cards(12) },
      recipe: FRACTAL_SPIRAL_RECIPE,
    });
    expect(plan.placements).toHaveLength(12);
    expect(overlappingPlacements(plan.placements)).toEqual([]);
    // Four cards per top-level cluster, two per cluster below, then pairs: the
    // spiral repeats three times, so the deepest cards are a quarter of the area.
    expect(scalesOf(plan.placements)).toEqual([step * step]);
    const flat = planFractalLayout({
      rootBoardId: "a",
      boards: { a: cards(12) },
      recipe: { ...FRACTAL_SPIRAL_RECIPE, levels: 1 },
    });
    expect(defined(plan.bounds).width).not.toBeCloseTo(defined(flat.bounds).width);
  });
});

describe("nesting proposals", () => {
  it("should propose one container per cluster without moving a card", () => {
    const boards = { a: cards(12) };
    const flat = planFractalLayout({
      rootBoardId: "a",
      boards,
      recipe: recipe({ pattern: "grid", levels: 3, branching: 3 }),
    });
    const nested = planFractalLayout({
      rootBoardId: "a",
      boards,
      recipe: recipe({ pattern: "grid", levels: 3, branching: 3, nest: true }),
    });
    expect(nested.placements).toStrictEqual(flat.placements);
    const proposals = nested.proposals ?? [];
    // Three top-level clusters of four; each of those splits into two pairs.
    expect(proposals).toHaveLength(9);
    expect(proposals.filter((proposal) => proposal.level === 1)).toHaveLength(3);
    expect(proposals.filter((proposal) => proposal.level === 2)).toHaveLength(6);
    expect(proposals.every((proposal) => proposal.boardId === "a")).toBe(true);
    expect(
      proposals.every((proposal) => proposal.ids.length === 2 || proposal.ids.length === 4),
    ).toBe(true);
    const placementById = new Map(nested.placements.map((placement) => [placement.id, placement]));
    for (const proposal of proposals) {
      for (const id of proposal.ids) {
        const placement = defined(placementById.get(id));
        expect(placement.x).toBeGreaterThanOrEqual(proposal.rect.x - 1e-6);
        expect(placement.y).toBeGreaterThanOrEqual(proposal.rect.y - 1e-6);
        expect(placement.x + placement.width).toBeLessThanOrEqual(
          proposal.rect.x + proposal.rect.width + 1e-6,
        );
        expect(placement.y + placement.height).toBeLessThanOrEqual(
          proposal.rect.y + proposal.rect.height + 1e-6,
        );
      }
    }
  });

  it("should not propose anything when nest is off", () => {
    const plan = planFractalLayout({
      rootBoardId: "a",
      boards: { a: cards(12) },
      recipe: recipe({ pattern: "grid", levels: 3, branching: 3 }),
    });
    expect("proposals" in plan).toBe(false);
  });
});
