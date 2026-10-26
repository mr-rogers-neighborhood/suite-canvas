import { describe, expect, it } from "vitest";
import { createWorkspaceFile, readWorkspaceFile } from "../workspaceFile.js";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function workspace() {
  const doc = new WorkspaceDocument();
  const first = doc.createBoard({ name: "First" });
  const second = doc.createBoard({ name: "Second" });
  return { doc, first, second };
}

/**
 * Gate A24's navigation corner: a workspace can name the board it opens when
 * nothing else is open, and the board a new tab should open. Both are ids in
 * workspace meta rather than flags on a board, so a second board being home never
 * needs a sweep of the board records to stay true.
 */
describe("workspace navigation boards", () => {
  it("names nothing until it is told", () => {
    const { doc } = workspace();
    expect(doc.workspaceHomeBoardId()).toBeNull();
    expect(doc.newTabBoardId()).toBeNull();
  });

  it("stores and reads both ids", () => {
    const { doc, first, second } = workspace();
    doc.setWorkspaceHomeBoardId(first.id);
    doc.setNewTabBoardId(second.id);

    expect(doc.workspaceHomeBoardId()).toBe(first.id);
    expect(doc.newTabBoardId()).toBe(second.id);
  });

  it("clears with null", () => {
    const { doc, first } = workspace();
    doc.setWorkspaceHomeBoardId(first.id);
    doc.setWorkspaceHomeBoardId(null);
    expect(doc.workspaceHomeBoardId()).toBeNull();
  });

  it("refuses a board that does not exist", () => {
    const { doc } = workspace();
    doc.setWorkspaceHomeBoardId("no-such-board");
    expect(doc.workspaceHomeBoardId()).toBeNull();
  });

  it("drops a reference when its board is deleted", () => {
    const { doc, first, second } = workspace();
    doc.setWorkspaceHomeBoardId(first.id);
    doc.setNewTabBoardId(first.id);

    doc.deleteBoard(first.id);

    // Not a dangling id: a home that opens nothing would be worse than no home.
    expect(doc.workspaceHomeBoardId()).toBeNull();
    expect(doc.newTabBoardId()).toBeNull();
    // The surviving board is untouched and can be named instead.
    doc.setWorkspaceHomeBoardId(second.id);
    expect(doc.workspaceHomeBoardId()).toBe(second.id);
  });

  it("keeps a reference to a board that is merely not open", () => {
    const { doc, first } = workspace();
    doc.setWorkspaceHomeBoardId(first.id);
    expect(doc.listBoards().some((board) => board.id === first.id)).toBe(true);
    expect(doc.workspaceHomeBoardId()).toBe(first.id);
  });

  it("survives a backup and restore, which is what makes it the workspace's", () => {
    const { doc, second } = workspace();
    doc.setWorkspaceHomeBoardId(second.id);
    doc.setNewTabBoardId(second.id);

    const { json } = createWorkspaceFile("ws-navigation", doc, "2026-10-26T00:00:00.000Z");
    const { workspace: restored } = readWorkspaceFile(json);

    expect(restored.workspaceHomeBoardId()).toBe(second.id);
    expect(restored.newTabBoardId()).toBe(second.id);
  });
});
