import { describe, expect, it } from "vitest";
import { boardCommonAncestor, edgeFrameOf } from "../boards.js";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function setup() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const home = workspace.ensureView();
  const outer = workspace.createBoard({
    name: "Outer",
    parentBoardId: home.id,
    x: 100,
    y: 100,
    width: 600,
    height: 600,
  });
  const left = workspace.createBoard({
    name: "Left",
    parentBoardId: outer.id,
    x: 20,
    y: 20,
    width: 200,
    height: 200,
  });
  const right = workspace.createBoard({
    name: "Right",
    parentBoardId: outer.id,
    x: 300,
    y: 20,
    width: 200,
    height: 200,
  });
  return { workspace, home, outer, left, right };
}

describe("listSubtreeEdges", () => {
  it("should list a link between two cards on the same Board", () => {
    const { workspace, home, left } = setup();
    const a = workspace.createCard({ boardId: left.id, position: { x: 10, y: 10 } });
    const b = workspace.createCard({ boardId: left.id, position: { x: 50, y: 50 } });
    const edge = workspace.addEdge({ boardId: left.id, source: a.id, target: b.id });
    if (!edge) throw new Error("expected an edge");

    expect(workspace.listSubtreeEdges(left.id).map((entry) => entry.id)).toEqual([edge.id]);
    expect(workspace.listSubtreeEdges(home.id).map((entry) => entry.id)).toEqual([edge.id]);
    expect(workspace.listBoardEdges(left.id).map((entry) => entry.id)).toEqual([edge.id]);
  });

  it("should draw a link between sibling child Boards at their common ancestor", () => {
    const { workspace, home, outer, left, right } = setup();
    const a = workspace.createCard({ boardId: left.id, position: { x: 10, y: 10 } });
    const b = workspace.createCard({ boardId: right.id, position: { x: 10, y: 10 } });
    const edge = workspace.addEdge({ boardId: outer.id, source: a.id, target: b.id });
    if (!edge) throw new Error("expected an edge");

    expect(workspace.listSubtreeEdges(outer.id).map((entry) => entry.id)).toEqual([edge.id]);
    expect(workspace.listSubtreeEdges(home.id).map((entry) => entry.id)).toEqual([edge.id]);
    // A sibling does not contain the other endpoint, so it draws nothing.
    expect(workspace.listSubtreeEdges(left.id)).toEqual([]);
    expect(workspace.listSubtreeEdges(right.id)).toEqual([]);

    // The ancestor is not the single plane `listBoardEdges` reports on.
    expect(workspace.listBoardEdges(outer.id)).toEqual([]);
    expect(workspace.listBoardEdges(left.id)).toEqual([]);
    expect(workspace.listBoardEdges(right.id)).toEqual([]);
  });

  it("should list a link on a Board three levels deep from every ancestor", () => {
    const { workspace, home, outer, left } = setup();
    const deep = workspace.createBoard({
      name: "Deep",
      parentBoardId: left.id,
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    });
    const a = workspace.createCard({ boardId: deep.id, position: { x: 1, y: 1 } });
    const b = workspace.createCard({ boardId: deep.id, position: { x: 5, y: 5 } });
    const edge = workspace.addEdge({ boardId: deep.id, source: a.id, target: b.id });
    if (!edge) throw new Error("expected an edge");

    for (const boardId of [deep.id, left.id, outer.id, home.id]) {
      expect(workspace.listSubtreeEdges(boardId).map((entry) => entry.id)).toEqual([edge.id]);
    }

    expect(workspace.listBoardEdges(deep.id).map((entry) => entry.id)).toEqual([edge.id]);
    expect(workspace.listBoardEdges(left.id)).toEqual([]);
    expect(workspace.listBoardEdges(outer.id)).toEqual([]);
  });

  it("should keep a link dormant while an endpoint is in the trash or unplaced", () => {
    const { workspace, left } = setup();
    const a = workspace.createCard({ boardId: left.id, position: { x: 10, y: 10 } });
    const b = workspace.createCard({ boardId: left.id, position: { x: 50, y: 50 } });
    const edge = workspace.addEdge({ boardId: left.id, source: a.id, target: b.id });
    if (!edge) throw new Error("expected an edge");

    workspace.trashCard(b.id);
    expect(workspace.listSubtreeEdges(left.id)).toEqual([]);
    expect(workspace.listBoardEdges(left.id)).toEqual([]);
    // Dormant, not deleted: the link survives the detour and revives.
    expect(workspace.getEdge(edge.id)).toBeDefined();

    workspace.restoreCard(b.id);
    expect(workspace.listSubtreeEdges(left.id).map((entry) => entry.id)).toEqual([edge.id]);

    workspace.unplaceCard(left.id, b.id);
    expect(workspace.listSubtreeEdges(left.id)).toEqual([]);
    expect(workspace.getEdge(edge.id)).toBeDefined();

    workspace.placeCard(left.id, b.id, { x: 50, y: 50 });
    expect(workspace.listSubtreeEdges(left.id).map((entry) => entry.id)).toEqual([edge.id]);
  });

  it("should keep a link dormant when an endpoint moves outside the subtree", () => {
    const { workspace, home, outer, left } = setup();
    const a = workspace.createCard({ boardId: left.id, position: { x: 10, y: 10 } });
    const b = workspace.createCard({ boardId: left.id, position: { x: 50, y: 50 } });
    const edge = workspace.addEdge({ boardId: left.id, source: a.id, target: b.id });
    if (!edge) throw new Error("expected an edge");

    workspace.moveCardToBoard(b.id, home.id, { x: 0, y: 0 });

    expect(workspace.listSubtreeEdges(outer.id)).toEqual([]);
    expect(workspace.listSubtreeEdges(left.id)).toEqual([]);
    expect(workspace.listBoardEdges(left.id)).toEqual([]);
    expect(workspace.getEdge(edge.id)).toBeDefined();
    // The View root still holds both endpoints, so the link is drawn there.
    expect(workspace.listSubtreeEdges(home.id).map((entry) => entry.id)).toEqual([edge.id]);

    workspace.moveCardToBoard(b.id, left.id, { x: 50, y: 50 });
    expect(workspace.listSubtreeEdges(outer.id).map((entry) => entry.id)).toEqual([edge.id]);
  });

  it("should leave listBoardEdges single-plane across every nesting case", () => {
    const { workspace, home, outer, left, right } = setup();
    const sameA = workspace.createCard({ boardId: left.id, position: { x: 1, y: 1 } });
    const sameB = workspace.createCard({ boardId: left.id, position: { x: 2, y: 2 } });
    const crossA = workspace.createCard({ boardId: left.id, position: { x: 3, y: 3 } });
    const crossB = workspace.createCard({ boardId: right.id, position: { x: 4, y: 4 } });
    workspace.addEdge({ boardId: left.id, source: sameA.id, target: sameB.id });
    workspace.addEdge({ boardId: outer.id, source: crossA.id, target: crossB.id });

    expect(workspace.listBoardEdges(left.id)).toHaveLength(1);
    expect(workspace.listBoardEdges(right.id)).toHaveLength(0);
    expect(workspace.listBoardEdges(outer.id)).toHaveLength(0);
    // A View root only reports links whose own Board is the root.
    expect(workspace.listBoardEdges(home.id)).toHaveLength(0);
    expect(workspace.listSubtreeEdges(outer.id)).toHaveLength(2);
    expect(workspace.listSubtreeEdges(home.id)).toHaveLength(2);
  });
});

describe("edgeFrameOf", () => {
  it("should frame a link at the lowest common ancestor of its Boards", () => {
    const { workspace, home, outer, left, right } = setup();
    const boards = workspace.listBoards();

    expect(boardCommonAncestor(boards, left.id, right.id)).toBe(outer.id);
    expect(boardCommonAncestor(boards, left.id, left.id)).toBe(left.id);
    expect(boardCommonAncestor(boards, outer.id, left.id)).toBe(outer.id);
    expect(edgeFrameOf(boards, left.id, right.id)).toEqual({
      boardId: outer.id,
      depth: 1,
      ancestor: home.id,
    });
    expect(edgeFrameOf(boards, left.id, left.id)).toEqual({
      boardId: left.id,
      depth: 2,
      ancestor: outer.id,
    });
  });

  it("should list a link that ends on a Board (ADR-0041)", () => {
    const { workspace, outer, left } = setup();
    const a = workspace.createCard({ boardId: outer.id, position: { x: 10, y: 10 } });
    const edge = workspace.addEdge({
      boardId: outer.id,
      source: a.id,
      target: left.id,
      targetKind: "board",
    });
    if (!edge) throw new Error("expected an edge");

    // The frame is a Board end, so it needs no placement: the frame is the end.
    expect(edge.targetKind).toBe("board");
    expect(edge.sourceKind).toBeUndefined();
    expect(workspace.listSubtreeEdges(outer.id).map((entry) => entry.id)).toEqual([edge.id]);
    expect(workspace.listBoardEdges(outer.id).map((entry) => entry.id)).toEqual([edge.id]);
    // A link into a frame is not drawn *inside* that frame: its ends are not both
    // on that plane.
    expect(workspace.listSubtreeEdges(left.id)).toEqual([]);
  });

  it("should keep a link between two frames, and forget one whose frame left", () => {
    const { workspace, home, outer, left, right } = setup();
    const edge = workspace.addEdge({
      boardId: outer.id,
      source: left.id,
      sourceKind: "board",
      target: right.id,
      targetKind: "board",
    });
    if (!edge) throw new Error("expected an edge");
    expect(workspace.listSubtreeEdges(home.id).map((entry) => entry.id)).toEqual([edge.id]);
    expect(edge).toMatchObject({ sourceKind: "board", targetKind: "board" });

    // A dormancy, not a deletion: the link comes back with the frame.
    workspace.deleteBoard(right.id);
    expect(workspace.listSubtreeEdges(home.id)).toEqual([]);
  });

  it("should round-trip the endpoint kinds through the stored map", () => {
    const { workspace, outer, left, right } = setup();
    const edge = workspace.addEdge({
      boardId: outer.id,
      source: left.id,
      sourceKind: "board",
      target: right.id,
      targetKind: "board",
    });
    if (!edge) throw new Error("expected an edge");

    const stored = workspace.getEdge(edge.id);
    expect(stored).toMatchObject({ sourceKind: "board", targetKind: "board" });
  });

  it("should have no frame for Boards under different Views", () => {
    const { workspace, left } = setup();
    const other = workspace.createView({ name: "Elsewhere" });
    const boards = workspace.listBoards();

    expect(boardCommonAncestor(boards, left.id, other.id)).toBeUndefined();
    expect(edgeFrameOf(boards, left.id, other.id)).toBeUndefined();
  });

  it("should frame a link between cards on the View root and a nested Board", () => {
    const { workspace, home, outer, left } = setup();
    const boards = workspace.listBoards();

    expect(edgeFrameOf(boards, home.id, left.id)).toEqual({
      boardId: home.id,
      depth: 0,
    });
    expect(edgeFrameOf(boards, left.id, outer.id)?.boardId).toBe(outer.id);
  });
});
