import { describe, expect, it } from "vitest";
import type { Placement, Section } from "../schema.js";
import { planSectionFit } from "./sectionFitPlan.js";

const BOARD = "board-1";

function section(overrides: Partial<Section> & Pick<Section, "id" | "x" | "y">): Section {
  return {
    boardId: BOARD,
    title: overrides.id,
    width: 400,
    height: 300,
    z: 0,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function placement(cardId: string, x: number, y: number): Placement {
  return {
    cardId,
    boardId: BOARD,
    x,
    y,
    width: 200,
    height: 120,
    z: 1,
    createdAt: 1,
  };
}

const sizes = new Map([["outer-card", { width: 200, height: 120 }]]);

/** The rect a plan writes for a section, or undefined when it left it alone. */
function written(plan: ReturnType<typeof planSectionFit>, sectionId: string) {
  return plan?.sections?.find((entry) => entry.sectionId === sectionId);
}

describe("fitting a section around its members", () => {
  it("does nothing when every frame already holds what it holds", () => {
    const plan = planSectionFit({
      boardId: BOARD,
      // Already tight: 24 of padding on three sides, 40 above the first card.
      sections: [section({ id: "outer", x: 76, y: 60, width: 248, height: 184 })],
      placements: [placement("card-1", 100, 100)],
      cardSizes: new Map([["card-1", { width: 200, height: 120 }]]),
    });
    expect(plan).toBeNull();
  });

  /**
   * The nesting bug in one assertion: the card belongs to the inner frame, so the outer frame
   * sees no cards of its own. Counting the child as a member is what keeps the parent around it.
   */
  it("counts a nested section as a member of the frame around it", () => {
    const outer = section({ id: "outer", x: 0, y: 0, width: 900, height: 900 });
    const inner = section({ id: "inner", x: 100, y: 100, width: 300, height: 300 });

    const plan = planSectionFit({
      boardId: BOARD,
      sections: [outer, inner],
      placements: [placement("card-1", 120, 140)],
      cardSizes: new Map([["card-1", { width: 200, height: 120 }]]),
    });

    // The inner frame is tight around its card, and the outer frame is tight around the inner.
    expect(written(plan, "inner")).toMatchObject({ x: 96, y: 100, width: 248, height: 184 });
    expect(written(plan, "outer")).toMatchObject({ x: 72, y: 60, width: 296, height: 248 });
  });

  it("grows the outer frame when the inner one is resized, without being asked twice", () => {
    const outer = section({ id: "outer", x: 0, y: 0, width: 500, height: 500 });
    const inner = section({ id: "inner", x: 100, y: 100, width: 300, height: 300 });

    const plan = planSectionFit({
      boardId: BOARD,
      sections: [outer, inner],
      placements: [],
      // The reader has just dragged the inner frame's corner out past the parent.
      sectionOverrides: new Map([["inner", { x: 100, y: 100, width: 620, height: 400 }]]),
    });

    // The child keeps the size the reader gave it — a resize is not refitted away — and the plan
    // carries that rect as its own write, so the gesture is still a single batch.
    expect(written(plan, "inner")).toMatchObject({ x: 100, y: 100, width: 620, height: 400 });
    expect(written(plan, "outer")).toMatchObject({ x: 76, y: 60, width: 668, height: 464 });
  });

  it("leaves a fixed frame alone when it already contains the child", () => {
    const outer = section({
      id: "outer",
      x: 0,
      y: 0,
      width: 900,
      height: 900,
      shrinkToFit: false,
    });
    const inner = section({ id: "inner", x: 100, y: 100, width: 300, height: 300 });

    const plan = planSectionFit({
      boardId: BOARD,
      sections: [outer, inner],
      placements: [],
      sectionOverrides: new Map([["inner", { x: 120, y: 120, width: 320, height: 320 }]]),
    });

    // Elastic is off, so the outer frame only ever grows to hold what moved: it stays put.
    expect(written(plan, "outer")).toBeUndefined();
  });

  it("grows a fixed frame to hold a child that left its box", () => {
    const outer = section({
      id: "outer",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      shrinkToFit: false,
    });
    const inner = section({ id: "inner", x: 100, y: 100, width: 300, height: 300 });

    const plan = planSectionFit({
      boardId: BOARD,
      sections: [outer, inner],
      placements: [],
      sectionOverrides: new Map([["inner", { x: 100, y: 100, width: 480, height: 420 }]]),
    });

    expect(written(plan, "outer")).toMatchObject({ x: 0, y: 0, width: 604, height: 544 });
  });

  it("drops a child dragged clear of the frame, so the frame does not chase it", () => {
    const outer = section({ id: "outer", x: 0, y: 0, width: 500, height: 500 });
    const inner = section({ id: "inner", x: 100, y: 100, width: 200, height: 200 });
    // A card the outer frame keeps, so it has something to fit once the child leaves.
    const card = placement("card-1", 330, 330);

    const plan = planSectionFit({
      boardId: BOARD,
      sections: [outer, inner],
      placements: [card],
      cardSizes: new Map([["card-1", { width: 60, height: 60 }]]),
      // Both moved together, past the outer frame's right edge.
      sectionOverrides: new Map([["inner", { x: 800, y: 100, width: 200, height: 200 }]]),
      placementOverrides: new Map([["card-1", { x: 330, y: 330 }]]),
    });

    expect(written(plan, "outer")).toMatchObject({ x: 306, y: 290, width: 108, height: 124 });
    // The frame's right edge stops where its own card does, not where the departed child is.
    expect((written(plan, "outer")?.x ?? 0) + (written(plan, "outer")?.width ?? 0)).toBe(414);
  });

  it("leaves out a rect the caller has already written", () => {
    const plan = planSectionFit({
      boardId: BOARD,
      sections: [
        section({ id: "outer", x: 0, y: 0, width: 900, height: 900 }),
        section({ id: "inner", x: 100, y: 100, width: 200, height: 200 }),
      ],
      placements: [placement("card-1", 330, 330)],
      cardSizes: new Map([["card-1", { width: 60, height: 60 }]]),
      sectionOverrides: new Map([["inner", { x: 400, y: 400, width: 200, height: 200 }]]),
      overridesAreWritten: true,
    });

    // The child moved outward, so the parent still fits around it — but the child's own write
    // belongs to the caller's batch, not to this plan.
    expect(written(plan, "inner")).toBeUndefined();
    expect(written(plan, "outer")).toBeDefined();
  });

  it("follows a card that moved inside the frame", () => {
    const plan = planSectionFit({
      boardId: BOARD,
      sections: [section({ id: "outer", x: 0, y: 0, width: 500, height: 400 })],
      placements: [placement("card-1", 100, 100)],
      cardSizes: sizes,
      placementOverrides: new Map([["card-1", { x: 100, y: 300 }]]),
    });

    expect(written(plan, "outer")).toMatchObject({ x: 76, y: 260, width: 248, height: 184 });
  });

  it("collapses an emptied frame only when the reader asked it to fit", () => {
    const lone = [section({ id: "outer", x: 40, y: 60, width: 500, height: 400 })];

    expect(planSectionFit({ boardId: BOARD, sections: lone, placements: [] })).toBeNull();

    const plan = planSectionFit({
      boardId: BOARD,
      sections: lone,
      placements: [],
      collapseEmpty: new Set(["outer"]),
    });
    expect(written(plan, "outer")).toMatchObject({ x: 40, y: 60, width: 160, height: 120 });
  });

  it("ignores a section on another board", () => {
    const plan = planSectionFit({
      boardId: BOARD,
      sections: [
        section({ id: "outer", x: 0, y: 0, width: 900, height: 900 }),
        section({ id: "elsewhere", boardId: "board-2", x: 0, y: 0, width: 100, height: 100 }),
      ],
      placements: [],
      collapseEmpty: new Set(["elsewhere"]),
    });
    expect(plan).toBeNull();
  });
});
