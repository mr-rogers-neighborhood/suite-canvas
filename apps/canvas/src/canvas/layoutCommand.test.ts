import { WorkspaceDocument } from "@suite/graph";
import { DEFAULT_FRACTAL_RECIPE, type FractalRecipe } from "@suite/scene";
import { describe, expect, it } from "vitest";
import {
  applyBoardFractal,
  type LayoutSnapshot,
  planBoardFractal,
  planFractalTree,
} from "./layoutCommand";

function snapshotOf(workspace: WorkspaceDocument): LayoutSnapshot {
  return {
    boards: workspace.listBoards(),
    cards: workspace.listCards(),
    placements: workspace.listPlacements(),
  };
}

function recipe(overrides: Partial<FractalRecipe> = {}): FractalRecipe {
  return { ...DEFAULT_FRACTAL_RECIPE, gap: 20, padding: 0, ...overrides };
}

function gridWorkspace(count = 4) {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  const cards = Array.from({ length: count }, (_, index) =>
    workspace.createCard({ boardId: board.id, position: { x: index * 40, y: index * 30 } }),
  );
  return { workspace, board, cards };
}

function portalWorkspace() {
  const workspace = new WorkspaceDocument();
  const root = workspace.ensureBoard();
  const middle = workspace.createBoard({ name: "Middle" });
  const leaf = workspace.createBoard({ name: "Leaf" });
  const rootCard = workspace.createCard({ boardId: root.id, position: { x: 400, y: 400 } });
  const firstPortal = workspace.createPortalCard({
    boardId: root.id,
    targetBoardId: middle.id,
    position: { x: 800, y: 0 },
  });
  const middleCard = workspace.createCard({ boardId: middle.id, position: { x: 10, y: 10 } });
  const secondPortal = workspace.createPortalCard({
    boardId: middle.id,
    targetBoardId: leaf.id,
    position: { x: 300, y: 10 },
  });
  const leafCards = [
    workspace.createCard({ boardId: leaf.id, position: { x: 0, y: 0 } }),
    workspace.createCard({ boardId: leaf.id, position: { x: 100, y: 100 } }),
  ];
  return {
    workspace,
    root,
    middle,
    leaf,
    rootCard,
    firstPortal,
    middleCard,
    secondPortal,
    leafCards,
  };
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

  it("recurses through portals and sizes their frames", () => {
    const { workspace, root, middle, leaf, firstPortal, secondPortal, leafCards } =
      portalWorkspace();
    const snapshot = snapshotOf(workspace);

    const plan = planBoardFractal({
      snapshot,
      rootBoardId: root.id,
      recipe: recipe({ depth: { scale: 0.5, gap: 10, rotate: 0 } }),
    });

    expect(new Set(plan.boards)).toEqual(new Set([root.id, middle.id, leaf.id]));
    expect(plan.placements.filter((entry) => entry.boardId === root.id)).toHaveLength(2);
    expect(plan.placements.filter((entry) => entry.boardId === middle.id)).toHaveLength(2);
    expect(plan.placements.filter((entry) => entry.boardId === leaf.id)).toHaveLength(2);
    expect(Object.keys(plan.portalSizes ?? {}).sort()).toEqual(
      [firstPortal.id, secondPortal.id].sort(),
    );
    const leafFrames = plan.placements.filter((entry) => entry.cardId === secondPortal.id);
    expect(leafFrames[0]?.width).toBeGreaterThan(0);
    expect(leafCards).toHaveLength(2);
  });

  it("stops at a portal cycle and at the depth cap", () => {
    const workspace = new WorkspaceDocument();
    const a = workspace.ensureBoard();
    const b = workspace.createBoard({ name: "B" });
    workspace.createPortalCard({ boardId: a.id, targetBoardId: b.id, position: { x: 0, y: 0 } });
    workspace.createPortalCard({ boardId: b.id, targetBoardId: a.id, position: { x: 0, y: 0 } });
    const snapshot = snapshotOf(workspace);

    const plan = planBoardFractal({ snapshot, rootBoardId: a.id, recipe: recipe() });
    expect(plan.boards).toEqual([a.id, b.id]);
    expect(plan.placements).toHaveLength(2);

    const scene = planFractalTree({ snapshot, rootBoardId: a.id, recipe: recipe() });
    const child = scene.portals[0]?.child;
    expect(child?.issues.map((issue) => issue.code)).toContain("cycle");

    const capped = planBoardFractal({
      snapshot,
      rootBoardId: a.id,
      recipe: recipe(),
      recursive: false,
    });
    expect(capped.boards).toEqual([a.id]);
    expect(
      planFractalTree({ snapshot, rootBoardId: a.id, recipe: recipe(), maxDepth: 0 }).issues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "depth" })]));
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
