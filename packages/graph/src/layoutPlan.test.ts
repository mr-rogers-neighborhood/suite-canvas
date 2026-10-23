import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  type LayoutPlan,
  LayoutPlanError,
  MAX_LAYOUT_COORDINATE,
  parseLayoutPlan,
} from "./layoutPlan.js";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";

/** Counts commits, because one commit is the unit undo and history care about. */
function countCommits(workspace: WorkspaceDocument): () => number {
  let commits = 0;
  workspace.doc.subscribe(() => {
    commits += 1;
  });
  return () => commits;
}

function sync(a: LoroDoc, b: LoroDoc): void {
  const fromA = a.export({ mode: "update" });
  const fromB = b.export({ mode: "update" });
  b.import(fromA);
  a.import(fromB);
}

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  const other = workspace.createBoard({ name: "Other" });
  const first = workspace.createCard({ boardId: board.id, position: { x: 10, y: 20 } });
  const second = workspace.createCard({ boardId: board.id, position: { x: 200, y: 40 } });
  const third = workspace.createCard({ boardId: board.id, position: { x: 400, y: 300 } });
  const section = workspace.createSection({
    boardId: board.id,
    title: "Region",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  return { workspace, board, other, first, second, third, section };
}

function issuesOf(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof LayoutPlanError) return error.issues;
    throw error;
  }
  throw new Error("expected the plan to be rejected");
}

describe("applyLayoutPlan", () => {
  it("applies a cross-board plan in one commit and one undo step", () => {
    const { workspace, board, other, first, second } = setup();
    workspace.placeCard(other.id, first.id, { x: 0, y: 0 });
    const commits = countCommits(workspace);
    const plan: LayoutPlan = {
      boards: [board.id, other.id],
      placements: [
        { boardId: board.id, cardId: first.id, x: 100, y: 120 },
        { boardId: board.id, cardId: second.id, x: 300, y: 240 },
        { boardId: other.id, cardId: first.id, x: 40, y: 50 },
      ],
    };

    const summary = workspace.applyLayoutPlan(plan);

    expect(commits()).toBe(1);
    expect(summary).toEqual({ placements: 3, sections: 0, boards: 2 });
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 100, y: 120 });
    expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 300, y: 240 });
    expect(workspace.getPlacement(other.id, first.id)).toMatchObject({ x: 40, y: 50 });

    workspace.undo();

    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 10, y: 20 });
    expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 200, y: 40 });
    expect(workspace.getPlacement(other.id, first.id)).toMatchObject({ x: 0, y: 0 });
  });

  it("writes only the fields the plan names", () => {
    const { workspace, board, first } = setup();
    workspace.updatePlacementSize(board.id, first.id, { width: 320, height: 240 });

    workspace.applyLayoutPlan({
      boards: [board.id],
      placements: [{ boardId: board.id, cardId: first.id, x: 50, y: 60 }],
    });

    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({
      x: 50,
      y: 60,
      width: 320,
      height: 240,
    });
  });

  it("moves sections in the same batch", () => {
    const { workspace, board, first, section } = setup();
    const commits = countCommits(workspace);

    const summary = workspace.applyLayoutPlan({
      boards: [board.id],
      placements: [{ boardId: board.id, cardId: first.id, x: 30, y: 40 }],
      sections: [{ sectionId: section.id, x: 100, y: 200, width: 500, height: 260 }],
    });

    expect(commits()).toBe(1);
    expect(summary).toEqual({ placements: 1, sections: 1, boards: 1 });
    expect(workspace.getSection(section.id)).toMatchObject({
      x: 100,
      y: 200,
      width: 500,
      height: 260,
    });

    workspace.undo();

    expect(workspace.getSection(section.id)).toMatchObject({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 10, y: 20 });
  });

  it("clamps section sizes to the minimum geometry", () => {
    const { workspace, section } = setup();

    workspace.applyLayoutPlan({
      boards: [],
      placements: [],
      sections: [{ sectionId: section.id, x: 0, y: 0, width: 10, height: 10 }],
    });

    expect(workspace.getSection(section.id)).toMatchObject({ width: 80, height: 60 });
  });

  it("sizes a portal frame without a placement entry", () => {
    const { workspace, board, first } = setup();

    const summary = workspace.applyLayoutPlan({
      boards: [board.id],
      placements: [],
      portalSizes: { [first.id]: { width: 480, height: 360 } },
    });

    expect(summary).toEqual({ placements: 1, sections: 0, boards: 1 });
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({
      x: 10,
      y: 20,
      width: 480,
      height: 360,
    });
  });

  it("prefers explicit placement geometry over a portal size", () => {
    const { workspace, board, first } = setup();

    workspace.applyLayoutPlan({
      boards: [board.id],
      placements: [{ boardId: board.id, cardId: first.id, x: 0, y: 0, width: 100, height: 80 }],
      portalSizes: { [first.id]: { width: 480, height: 360 } },
    });

    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({
      width: 100,
      height: 80,
    });
  });

  it("creates a placement for a card that is not on the board yet", () => {
    const { workspace, other, third } = setup();

    workspace.applyLayoutPlan({
      boards: [other.id],
      placements: [{ boardId: other.id, cardId: third.id, x: 12, y: 34 }],
    });

    expect(workspace.getPlacement(other.id, third.id)).toMatchObject({ x: 12, y: 34 });
  });

  it("clamps finite coordinates outside the publish range", () => {
    const { workspace, board, first } = setup();

    workspace.applyLayoutPlan({
      boards: [board.id],
      placements: [{ boardId: board.id, cardId: first.id, x: 1e12, y: -1e12 }],
    });

    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({
      x: MAX_LAYOUT_COORDINATE,
      y: -MAX_LAYOUT_COORDINATE,
    });
  });
});

describe("applyLayoutPlan validation", () => {
  it("rejects duplicate placements on one board and writes nothing", () => {
    const { workspace, board, first } = setup();
    const commits = countCommits(workspace);

    const issues = issuesOf(() =>
      workspace.applyLayoutPlan({
        boards: [board.id],
        placements: [
          { boardId: board.id, cardId: first.id, x: 0, y: 0 },
          { boardId: board.id, cardId: first.id, x: 10, y: 10 },
        ],
      }),
    );

    expect(issues).toContain(`Duplicate placement for card ${first.id} on board ${board.id}`);
    expect(commits()).toBe(0);
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 10, y: 20 });
  });

  it("rejects unknown boards, cards and sections and writes nothing", () => {
    const { workspace, board, first } = setup();
    const commits = countCommits(workspace);

    const issues = issuesOf(() =>
      workspace.applyLayoutPlan({
        boards: [board.id, "missing-board"],
        placements: [{ boardId: board.id, cardId: "missing-card", x: 0, y: 0 }],
        sections: [{ sectionId: "missing-section", x: 0, y: 0, width: 100, height: 100 }],
        portalSizes: { "missing-portal": { width: 10, height: 10 } },
      }),
    );

    expect(issues).toContain("Unknown board: missing-board");
    expect(issues).toContain("Unknown card: missing-card");
    expect(issues).toContain("Unknown section: missing-section");
    expect(issues).toContain("Unknown card: missing-portal");
    expect(commits()).toBe(0);
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 10, y: 20 });
  });

  it("rejects non-finite coordinates and non-positive sizes", () => {
    expect(() =>
      parseLayoutPlan({
        boards: ["b"],
        placements: [{ boardId: "b", cardId: "c", x: Number.POSITIVE_INFINITY, y: 0 }],
      }),
    ).toThrow(LayoutPlanError);
    expect(() =>
      parseLayoutPlan({
        boards: ["b"],
        placements: [{ boardId: "b", cardId: "c", x: Number.NaN, y: 0 }],
      }),
    ).toThrow(LayoutPlanError);
    expect(() =>
      parseLayoutPlan({
        boards: ["b"],
        placements: [{ boardId: "b", cardId: "c", x: 0, y: 0, width: 0 }],
      }),
    ).toThrow(LayoutPlanError);
    expect(() =>
      parseLayoutPlan({
        boards: [],
        placements: [],
        sections: [{ sectionId: "s", x: 0, y: 0, width: 100, height: Number.NaN }],
      }),
    ).toThrow(LayoutPlanError);
  });

  it("rejects two writes for the same section", () => {
    const { workspace, section } = setup();

    const issues = issuesOf(() =>
      workspace.applyLayoutPlan({
        boards: [],
        placements: [],
        sections: [
          { sectionId: section.id, x: 0, y: 0, width: 100, height: 100 },
          { sectionId: section.id, x: 10, y: 10, width: 100, height: 100 },
        ],
      }),
    );

    expect(issues).toContain(`Duplicate section: ${section.id}`);
  });
});

describe("applyLayoutPlan no-ops", () => {
  it("does not commit when the plan matches the document", () => {
    const { workspace, board, first, section } = setup();
    const commits = countCommits(workspace);

    const summary = workspace.applyLayoutPlan({
      boards: [board.id],
      placements: [{ boardId: board.id, cardId: first.id, x: 10, y: 20 }],
      sections: [{ sectionId: section.id, x: 0, y: 0, width: 400, height: 300 }],
    });

    expect(summary).toEqual({ placements: 0, sections: 0, boards: 0 });
    expect(commits()).toBe(0);
  });

  it("does not commit for an empty plan", () => {
    const { workspace } = setup();
    const commits = countCommits(workspace);

    expect(workspace.applyLayoutPlan({ boards: [], placements: [] })).toEqual({
      placements: 0,
      sections: 0,
      boards: 0,
    });
    expect(commits()).toBe(0);
  });
});

describe("applyLayoutPlan concurrency", () => {
  it("merges concurrent plans to different cards", () => {
    const left = new WorkspaceDocument();
    const board = left.ensureBoard();
    const first = left.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const second = left.createCard({ boardId: board.id, position: { x: 300, y: 0 } });

    const right = new WorkspaceDocument(new LoroDoc());
    right.doc.import(left.doc.export({ mode: "snapshot" }));

    left.applyLayoutPlan({
      boards: [board.id],
      placements: [{ boardId: board.id, cardId: first.id, x: 11, y: 22 }],
    });
    right.applyLayoutPlan({
      boards: [board.id],
      placements: [{ boardId: board.id, cardId: second.id, x: 333, y: 444 }],
    });

    sync(left.doc, right.doc);

    for (const workspace of [left, right]) {
      expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 11, y: 22 });
      expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 333, y: 444 });
    }
  });
});
