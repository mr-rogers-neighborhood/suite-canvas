import { WorkspaceDocument } from "@suite/graph";
import { DEFAULT_FRACTAL_RECIPE, type FractalRecipe } from "@suite/scene";
import { describe, expect, it } from "vitest";
import { applyBoardFractal, type LayoutSnapshot, planBoardFractal } from "./layoutCommand";

function snapshotOf(workspace: WorkspaceDocument): LayoutSnapshot {
  return {
    boards: workspace.listBoards(),
    views: workspace.listViews(),
    cards: workspace.listCards(),
    placements: workspace.listPlacements(),
    sections: workspace.listSections(),
    edges: workspace.listEdges(),
  };
}

function recipe(overrides: Partial<FractalRecipe> = {}): FractalRecipe {
  return { ...DEFAULT_FRACTAL_RECIPE, gap: 20, padding: 0, ...overrides };
}

function gridWorkspace(count = 4) {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureView();
  const cards = Array.from({ length: count }, (_, index) =>
    workspace.createCard({ boardId: board.id, position: { x: index * 40, y: index * 30 } }),
  );
  return { workspace, board, cards };
}

describe("planBoardFractal", () => {
  it("arranges the root board in a grid without writing", () => {
    const { workspace, board, cards } = gridWorkspace();
    const snapshot = snapshotOf(workspace);
    const before = JSON.stringify(snapshot.placements);

    const plan = planBoardFractal({ snapshot, rootBoardId: board.id, recipe: recipe() });

    expect(plan.boards).toEqual([board.id]);
    expect(plan.placements).toHaveLength(cards.length);
    expect(new Set(plan.placements.map((placement) => placement.cardId)).size).toBe(cards.length);
    expect(plan.portalSizes).toEqual({});
    expect(JSON.stringify(snapshot.placements)).toBe(before);
    expect(workspace.listPlacements()).toEqual(snapshot.placements);
  });

  it("honours a radial recipe", () => {
    const { workspace, board } = gridWorkspace(5);
    const snapshot = snapshotOf(workspace);

    const grid = planBoardFractal({ snapshot, rootBoardId: board.id, recipe: recipe() });
    const radial = planBoardFractal({
      snapshot,
      rootBoardId: board.id,
      recipe: recipe({ pattern: "radial" }),
    });

    expect(radial.placements).toHaveLength(5);
    expect(radial.placements).not.toEqual(grid.placements);
    expect(
      planBoardFractal({ snapshot, rootBoardId: board.id, recipe: recipe({ pattern: "radial" }) }),
    ).toEqual(radial);
  });

  it("arranges the plane it is given and leaves a nested board alone", () => {
    const workspace = new WorkspaceDocument();
    const view = workspace.ensureView();
    const board = workspace.createBoard({ name: "Frame", parentBoardId: view.id });
    const planeCard = workspace.createCard({ boardId: view.id, position: { x: 400, y: 400 } });
    const inner = [
      workspace.createCard({ boardId: board.id, position: { x: 5, y: 5 } }),
      workspace.createCard({ boardId: board.id, position: { x: 40, y: 40 } }),
    ];
    const snapshot = snapshotOf(workspace);

    const plane = planBoardFractal({ snapshot, rootBoardId: view.id, recipe: recipe() });
    expect(plane.boards).toEqual([view.id]);
    expect(plane.placements.map((entry) => entry.cardId)).toEqual([planeCard.id]);
    expect(plane.portalSizes).toEqual({});

    // A Board is its own scope: arranging it arranges the cards it owns.
    const scoped = planBoardFractal({ snapshot, rootBoardId: board.id, recipe: recipe() });
    expect(scoped.boards).toEqual([board.id]);
    expect(new Set(scoped.placements.map((entry) => entry.cardId))).toEqual(
      new Set(inner.map((card) => card.id)),
    );
  });

  it("applies a nested board's layout without touching its parent's plane", () => {
    const workspace = new WorkspaceDocument();
    const view = workspace.ensureView();
    const board = workspace.createBoard({ name: "Frame", parentBoardId: view.id });
    const planeCard = workspace.createCard({ boardId: view.id, position: { x: 400, y: 400 } });
    const inner = workspace.createCard({ boardId: board.id, position: { x: 90, y: 90 } });
    const snapshot = snapshotOf(workspace);

    applyBoardFractal(workspace, { snapshot, rootBoardId: board.id, recipe: recipe() });

    expect(workspace.getPlacement(view.id, planeCard.id)).toMatchObject({ x: 400, y: 400 });
    expect(workspace.getPlacement(board.id, inner.id)).not.toMatchObject({ x: 90, y: 90 });
  });

  it("keeps pinned cards and arranges only the selection", () => {
    const { workspace, board, cards } = gridWorkspace(3);
    const [pinned, first, second] = cards;
    if (!pinned || !first || !second) throw new Error("fixture needs three cards");
    const snapshot = snapshotOf(workspace);

    const kept = planBoardFractal({
      snapshot,
      rootBoardId: board.id,
      recipe: recipe(),
      pinned: [pinned.id],
    });
    expect(kept.placements.find((entry) => entry.cardId === pinned.id)).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(kept.placements).toHaveLength(3);

    const selected = planBoardFractal({
      snapshot,
      rootBoardId: board.id,
      recipe: recipe(),
      selection: [first.id],
    });
    expect(selected.placements.map((entry) => entry.cardId)).toEqual([first.id]);
  });

  it("writes nothing until apply, and applies in one undoable step", () => {
    const { workspace, board, cards } = gridWorkspace(3);
    const [first] = cards;
    if (!first) throw new Error("fixture needs a card");
    const snapshot = snapshotOf(workspace);
    const before = workspace.getPlacement(board.id, first.id);
    expect(before).toMatchObject({ x: 0, y: 0 });

    planBoardFractal({ snapshot, rootBoardId: board.id, recipe: recipe({ padding: 64 }) });
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 0, y: 0 });

    const summary = applyBoardFractal(workspace, {
      snapshot,
      rootBoardId: board.id,
      recipe: recipe({ padding: 64 }),
    });

    expect(summary.boards).toBe(1);
    expect(summary.placements).toBe(3);
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 64, y: 64 });

    workspace.undo();
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 0, y: 0 });
  });
});
