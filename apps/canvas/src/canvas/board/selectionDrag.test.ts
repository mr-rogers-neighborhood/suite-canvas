import type { Placement, Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { dragDelta, mergeSectionWrites, selectionDragPlan } from "./selectionDrag";

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
  return { cardId, boardId: BOARD, x, y, width: 200, height: 120, z: 1, createdAt: 1 };
}

const DELTA = { x: 40, y: 25 };

describe("what a mixed selection drag moves", () => {
  it("moves nothing extra when no frame is selected", () => {
    const plan = selectionDragPlan({
      sections: [section({ id: "s1", x: 0, y: 0 })],
      placements: [placement("card-1", 100, 100)],
      selectedSectionIds: [],
      draggedNodeIds: ["card-1"],
      delta: DELTA,
    });
    expect(plan).toEqual({ sections: [], placements: [] });
  });

  it("moves the selected frame and the cards inside it", () => {
    const plan = selectionDragPlan({
      sections: [section({ id: "s1", x: 0, y: 0 })],
      placements: [placement("inside", 100, 100)],
      selectedSectionIds: ["s1"],
      draggedNodeIds: ["elsewhere"],
      delta: DELTA,
    });

    expect(plan.sections).toEqual([{ id: "s1", x: 40, y: 25 }]);
    expect(plan.placements).toEqual([{ boardId: BOARD, cardId: "inside", x: 140, y: 125 }]);
  });

  /** The card under the pointer is already at its new position; writing it again doubles the move. */
  it("leaves out a card React Flow is already carrying", () => {
    const plan = selectionDragPlan({
      sections: [section({ id: "s1", x: 0, y: 0 })],
      placements: [placement("inside", 100, 100), placement("also-inside", 200, 200)],
      selectedSectionIds: ["s1"],
      draggedNodeIds: ["inside"],
      delta: DELTA,
    });

    expect(plan.placements.map((entry) => entry.cardId)).toEqual(["also-inside"]);
  });

  it("takes the frames nested in it along", () => {
    const plan = selectionDragPlan({
      sections: [
        section({ id: "outer", x: 0, y: 0, width: 800, height: 600 }),
        section({ id: "inner", x: 100, y: 100, width: 200, height: 200 }),
        section({ id: "other", x: 2000, y: 0 }),
      ],
      placements: [],
      selectedSectionIds: ["outer"],
      draggedNodeIds: [],
      delta: DELTA,
    });

    expect(plan.sections).toEqual([
      { id: "outer", x: 40, y: 25 },
      { id: "inner", x: 140, y: 125 },
    ]);
  });

  it("does not touch a card in another frame", () => {
    const plan = selectionDragPlan({
      sections: [section({ id: "s1", x: 0, y: 0 }), section({ id: "s2", x: 2000, y: 0 })],
      placements: [placement("mine", 100, 100), placement("theirs", 2100, 100)],
      selectedSectionIds: ["s1"],
      draggedNodeIds: [],
      delta: DELTA,
    });

    expect(plan.placements.map((entry) => entry.cardId)).toEqual(["mine"]);
  });

  it("adds nothing for a gesture that ended where it started", () => {
    const plan = selectionDragPlan({
      sections: [section({ id: "s1", x: 0, y: 0 })],
      placements: [placement("inside", 100, 100)],
      selectedSectionIds: ["s1"],
      draggedNodeIds: [],
      delta: { x: 0, y: 0 },
    });
    expect(plan).toEqual({ sections: [], placements: [] });
  });
});

describe("reading the translation a drop made", () => {
  it("takes the delta from the first card with a stored position", () => {
    expect(
      dragDelta(
        [
          { cardId: "new", x: 500, y: 500 },
          { cardId: "known", x: 140, y: 125 },
        ],
        [placement("known", 100, 100)],
      ),
    ).toEqual({ x: 40, y: 25 });
  });

  it("reads nothing when no card has been placed before", () => {
    expect(dragDelta([{ cardId: "new", x: 500, y: 500 }], [])).toEqual({ x: 0, y: 0 });
  });
});

describe("merging a frame's move with its growth", () => {
  it("keeps the moved corner and the grown size", () => {
    const merged = mergeSectionWrites(
      [{ id: "s1", x: 40, y: 25 }],
      [{ id: "s1", x: 0, y: 0, width: 700, height: 500 }],
    );
    expect(merged).toEqual([{ id: "s1", x: 40, y: 25, width: 700, height: 500 }]);
  });

  it("keeps frames that only moved and frames that only grew", () => {
    const merged = mergeSectionWrites(
      [{ id: "moved", x: 10, y: 10 }],
      [{ id: "grown", x: 0, y: 0, width: 600, height: 400 }],
    );
    expect(merged).toEqual([
      { id: "grown", x: 0, y: 0, width: 600, height: 400 },
      { id: "moved", x: 10, y: 10 },
    ]);
  });
});
