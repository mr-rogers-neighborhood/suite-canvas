import { WorkspaceDocument } from "@suite/graph";
import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";

import { boardStructureKey, survivingEnteredPath, workspaceStructureKey } from "./iceBoardTree";

/**
 * The structural key is what decides whether the desk rebuilds its Board tree
 * or simply reconciles cards. Its contract is narrow on purpose: everything a
 * mat is drawn from changes it, and nothing a card is drawn from does.
 */

function workspace() {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const view = doc.ensureView();
  const board = doc.createBoard({
    name: "Frame",
    parentBoardId: view.id,
    x: 100,
    y: 100,
    width: 400,
    height: 300,
  });
  const card = doc.createCard({ boardId: view.id, position: { x: 20, y: 30 } });
  return { doc, view, board, card };
}

/** The editor writes rich text as a Loro tree; `createCard` only makes the map. */
function writeTitle(doc: WorkspaceDocument, cardId: string, text: string): void {
  const title = doc.getTitle(cardId);
  title.set("nodeName", "doc");
  title.ensureMergeableMap("attributes");
  const blocks = title.ensureMergeableList("children");
  blocks.clear();
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  paragraph.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, text);
}

describe("boardStructureKey", () => {
  it("should be stable while the tree is unchanged", () => {
    const { doc, view } = workspace();
    const first = workspaceStructureKey(doc, view.id);
    expect(workspaceStructureKey(doc, view.id)).toBe(first);
  });

  it("should change when a Board is created", () => {
    const { doc, view } = workspace();
    const before = workspaceStructureKey(doc, view.id);
    doc.createBoard({
      name: "New",
      parentBoardId: view.id,
      x: 600,
      y: 100,
      width: 200,
      height: 200,
    });
    expect(workspaceStructureKey(doc, view.id)).not.toBe(before);
  });

  it("should change when a Board is deleted", () => {
    const { doc, view, board } = workspace();
    const before = workspaceStructureKey(doc, view.id);
    doc.deleteBoard(board.id);
    expect(workspaceStructureKey(doc, view.id)).not.toBe(before);
  });

  it("should change when a Board is renamed", () => {
    const { doc, view, board } = workspace();
    const before = workspaceStructureKey(doc, view.id);
    doc.renameBoard(board.id, "Renamed");
    expect(workspaceStructureKey(doc, view.id)).not.toBe(before);
  });

  it("should change when a Board is recoloured", () => {
    const { doc, view, board } = workspace();
    const before = workspaceStructureKey(doc, view.id);
    doc.setBoardColor(board.id, "green");
    expect(workspaceStructureKey(doc, view.id)).not.toBe(before);
  });

  it("should change when a Board's rect moves or resizes", () => {
    const { doc, view, board } = workspace();
    const before = workspaceStructureKey(doc, view.id);
    doc.updateBoardRect(board.id, { x: 140 });
    const moved = workspaceStructureKey(doc, view.id);
    expect(moved).not.toBe(before);
    doc.updateBoardRect(board.id, { width: 520 });
    expect(workspaceStructureKey(doc, view.id)).not.toBe(moved);
  });

  it("should change when a Board is nested", () => {
    const { doc, view, board } = workspace();
    const parent = doc.createBoard({
      name: "Parent",
      parentBoardId: view.id,
      x: 700,
      y: 700,
      width: 600,
      height: 600,
    });
    const before = workspaceStructureKey(doc, view.id);
    doc.nestBoard(board.id, parent.id);
    expect(workspaceStructureKey(doc, view.id)).not.toBe(before);
  });

  it("should change when the View is renamed", () => {
    const { doc, view } = workspace();
    const before = workspaceStructureKey(doc, view.id);
    doc.renameView(view.id, "Second View");
    expect(workspaceStructureKey(doc, view.id)).not.toBe(before);
  });

  it("should not change for a card move, resize or text edit", () => {
    const { doc, view, card } = workspace();
    const before = workspaceStructureKey(doc, view.id);
    doc.updatePlacementPosition(view.id, card.id, { x: 900, y: 900 });
    doc.updatePlacementSize(view.id, card.id, { width: 320, height: 260 });
    writeTitle(doc, card.id, "A new title");
    expect(doc.displayTitle(card.id)).toBe("A new title");
    expect(workspaceStructureKey(doc, view.id)).toBe(before);
  });

  it("should not change for a Board on another View", () => {
    const { doc, view } = workspace();
    const before = workspaceStructureKey(doc, view.id);
    const other = doc.createView({ name: "Other" });
    doc.createBoard({
      name: "Elsewhere",
      parentBoardId: other.id,
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    expect(workspaceStructureKey(doc, view.id)).toBe(before);
  });

  it("should be null for a desk that frames no View", () => {
    const { doc } = workspace();
    expect(workspaceStructureKey(doc, null)).toBeNull();
  });

  it("should not depend on paint order", () => {
    const { doc, view, board } = workspace();
    const second = doc.createBoard({
      name: "Second",
      parentBoardId: view.id,
      x: 800,
      y: 100,
      width: 200,
      height: 200,
    });
    // A z-only change moves the Board in paint order; it is not drawn into the
    // mat, so the desk has no reason to rebuild for it.
    const key = boardStructureKey({ view: doc.getView(view.id), boards: doc.listBoards() });
    const reordered = boardStructureKey({
      view: doc.getView(view.id),
      boards: [...doc.listBoards()].reverse(),
    });
    expect(reordered).toBe(key);
    expect(second.id).not.toBe(board.id);
  });
});

describe("survivingEnteredPath", () => {
  it("should keep every level when every Board still exists", () => {
    const { doc, view, board } = workspace();
    const inner = doc.createBoard({
      name: "Inner",
      parentBoardId: board.id,
      x: 10,
      y: 10,
      width: 120,
      height: 120,
    });
    expect(survivingEnteredPath(doc.listBoards(), [board.id, inner.id])).toEqual([
      board.id,
      inner.id,
    ]);
    expect(survivingEnteredPath(doc.listBoards(), [])).toEqual([]);
    expect(view.id).toBeTruthy();
  });

  it("should stop at the nearest ancestor that still exists", () => {
    const { doc, board } = workspace();
    const inner = doc.createBoard({
      name: "Inner",
      parentBoardId: board.id,
      x: 10,
      y: 10,
      width: 120,
      height: 120,
    });
    doc.deleteBoard(inner.id);
    expect(survivingEnteredPath(doc.listBoards(), [board.id, inner.id])).toEqual([board.id]);
  });

  it("should drop to the plane when the outer Board is gone", () => {
    const { doc, view, board } = workspace();
    const inner = doc.createBoard({
      name: "Inner",
      parentBoardId: board.id,
      x: 10,
      y: 10,
      width: 120,
      height: 120,
    });
    doc.deleteBoard(board.id);
    expect(survivingEnteredPath(doc.listBoards(), [board.id, inner.id])).toEqual([]);
    expect(view.id).toBeTruthy();
  });
});
