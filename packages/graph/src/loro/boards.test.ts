import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function setup() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const home = workspace.ensureView();
  return { workspace, home };
}

describe("boards", () => {
  it("should create a Board on a View plane and read it back", () => {
    const { workspace, home } = setup();
    const board = workspace.createBoard({
      name: "Research",
      parentBoardId: home.id,
      x: 40,
      y: 60,
      width: 420,
      height: 300,
      color: "blue",
    });

    expect(workspace.getBoard(board.id)).toMatchObject({
      name: "Research",
      color: "blue",
      rect: { x: 40, y: 60, width: 420, height: 300 },
      parentBoardId: home.id,
    });
    expect(workspace.listBoards(home.id).map((entry) => entry.id)).toEqual([board.id]);
    // The legacy Section projection still describes it for the reference surfaces.
    expect(workspace.listSections(home.id)).toEqual([
      expect.objectContaining({ id: board.id, title: "Research", boardId: home.id, x: 40, y: 60 }),
    ]);
  });

  it("should rename, recolour, move and resize in one commit each", () => {
    const { workspace, home } = setup();
    const board = workspace.createBoard({ name: "One", parentBoardId: home.id });
    let commits = 0;
    workspace.doc.subscribe(() => {
      commits += 1;
    });

    workspace.renameBoard(board.id, "Two");
    workspace.setBoardColor(board.id, "rose");
    workspace.updateBoardRect(board.id, { x: 12, y: 34, width: 500, height: 400 });

    expect(commits).toBe(3);
    expect(workspace.getBoard(board.id)).toMatchObject({
      name: "Two",
      color: "rose",
      rect: { x: 12, y: 34, width: 500, height: 400 },
    });
  });

  it("should nest a Board in another and keep its place on screen", () => {
    const { workspace, home } = setup();
    const outer = workspace.createBoard({
      name: "Outer",
      parentBoardId: home.id,
      x: 100,
      y: 100,
      width: 600,
      height: 600,
    });
    const inner = workspace.createBoard({
      name: "Inner",
      parentBoardId: home.id,
      x: 300,
      y: 280,
      width: 120,
      height: 120,
    });

    workspace.nestBoard(inner.id, outer.id);

    expect(workspace.getBoard(inner.id)?.parentBoardId).toBe(outer.id);
    expect(workspace.getBoard(inner.id)?.rect.x).toBe(200);
    expect(workspace.getBoard(inner.id)?.rect.y).toBe(180);
    expect(workspace.boardWorldRect(inner.id)).toEqual({
      x: 300,
      y: 280,
      width: 120,
      height: 120,
    });
    expect(workspace.boardPath(inner.id)).toEqual([home.id, outer.id, inner.id]);
  });

  it("should refuse nesting a Board inside itself or its own descendant", () => {
    const { workspace, home } = setup();
    const outer = workspace.createBoard({ name: "Outer", parentBoardId: home.id });
    const inner = workspace.createBoard({ name: "Inner", parentBoardId: outer.id });

    expect(() => workspace.nestBoard(outer.id, outer.id)).toThrow(/cannot contain itself/);
    expect(() => workspace.nestBoard(outer.id, inner.id)).toThrow(/cannot contain itself/);
    // An unknown parent is a caller bug, not a silent no-op.
    expect(() => workspace.createBoard({ name: "Lost", parentBoardId: "ghost" })).toThrow(
      /Unknown board parent/,
    );
    expect(workspace.getBoard(outer.id)?.parentBoardId).toBe(home.id);
  });

  it("should delete a Board together with everything nested in it", () => {
    const { workspace, home } = setup();
    const outer = workspace.createBoard({ name: "Outer", parentBoardId: home.id });
    const inner = workspace.createBoard({ name: "Inner", parentBoardId: outer.id });
    const card = workspace.createCard({ boardId: inner.id, position: { x: 1, y: 2 } });

    workspace.deleteBoard(outer.id);

    expect(workspace.getBoard(outer.id)).toBeUndefined();
    expect(workspace.getBoard(inner.id)).toBeUndefined();
    expect(workspace.listCardPlacements(card.id)).toEqual([]);
    // The card survives; it simply has no place any more.
    expect(workspace.getCard(card.id)).toBeDefined();
  });

  it("should give a card exactly one Board and translate it into the View plane", () => {
    const { workspace, home } = setup();
    const board = workspace.createBoard({
      name: "Holder",
      parentBoardId: home.id,
      x: 500,
      y: 500,
      width: 400,
      height: 400,
    });
    const card = workspace.createCard({ boardId: board.id, position: { x: 20, y: 30 } });

    expect(workspace.listCardPlacements(card.id)).toHaveLength(1);
    expect(workspace.listCardPlacements(card.id)[0]?.boardId).toBe(board.id);
    // Reading the View's plane translates the child into View coordinates.
    expect(workspace.listBoardPlacements(home.id)[0]).toMatchObject({ x: 520, y: 530 });
    // Reading the Board gives frame-local coordinates.
    expect(workspace.listBoardPlacements(board.id)[0]).toMatchObject({ x: 20, y: 30 });
  });

  it("should move a Board and its placements in one commit", () => {
    const { workspace, home } = setup();
    const board = workspace.createBoard({ name: "Holder", parentBoardId: home.id });
    const card = workspace.createCard({ boardId: board.id, position: { x: 10, y: 10 } });
    let commits = 0;
    workspace.doc.subscribe(() => {
      commits += 1;
    });

    workspace.moveBoardBatch(board.id, { x: 100, y: 200 });

    expect(commits).toBe(1);
    expect(workspace.getBoard(board.id)?.rect.x).toBe(100);
    expect(workspace.listCardPlacements(card.id)[0]).toMatchObject({ x: 10, y: 10 });
  });
});

describe("views", () => {
  it("should round-trip a camera", () => {
    const { workspace } = setup();
    const view = workspace.createView({ name: "People" });

    workspace.setViewCamera(view.id, { x: -240, y: 96, zoom: 1.5 });

    expect(workspace.getView(view.id)?.camera).toEqual({ x: -240, y: 96, zoom: 1.5 });
    // A camera that did not move writes nothing.
    let commits = 0;
    workspace.doc.subscribe(() => {
      commits += 1;
    });
    workspace.setViewCamera(view.id, { x: -240, y: 96, zoom: 1.5 });
    expect(commits).toBe(0);
  });

  it("should refuse a camera that cannot be drawn", () => {
    const { workspace } = setup();
    const view = workspace.createView({ name: "People" });

    workspace.setViewCamera(view.id, { x: 0, y: 0, zoom: 0 });

    expect(workspace.getView(view.id)?.camera.zoom).toBe(1);
  });

  it("should rename a View without touching its camera", () => {
    const { workspace } = setup();
    const view = workspace.createView({ name: "People", camera: { x: 1, y: 2, zoom: 3 } });

    workspace.renameView(view.id, "  Humans  ");

    expect(workspace.getView(view.id)).toMatchObject({
      name: "Humans",
      camera: { x: 1, y: 2, zoom: 3 },
    });
  });

  it("should delete a View, its Board tree and their placements", () => {
    const { workspace, home } = setup();
    const board = workspace.createBoard({ name: "Holder", parentBoardId: home.id });
    const card = workspace.createCard({ boardId: home.id, position: { x: 0, y: 0 } });

    workspace.deleteView(home.id);

    expect(workspace.getView(home.id)).toBeUndefined();
    expect(workspace.getBoard(board.id)).toBeUndefined();
    expect(workspace.listCardPlacements(card.id)).toEqual([]);
    expect(workspace.getCard(card.id)).toBeDefined();
  });
});
