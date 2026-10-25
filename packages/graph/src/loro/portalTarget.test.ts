import { describe, expect, it } from "vitest";
import { PORTAL_BOARD_FIELD_ID, WorkspaceDocument } from "./WorkspaceDocument.js";

function setup() {
  const workspace = new WorkspaceDocument();
  const home = workspace.createBoard({ name: "Home" });
  const other = workspace.createBoard({ name: "Other" });
  const portal = workspace.createPortalCard({ boardId: home.id, targetBoardId: other.id });
  return { workspace, home, other, portal };
}

describe("portal target", () => {
  it("repoints a portal at another board, in one commit", () => {
    const { workspace, home, portal } = setup();
    const target = workspace.createBoard({ name: "Third" });
    const before = workspace.doc.version().toJSON();
    workspace.setPortalTarget(portal.id, target.id);
    expect(workspace.getCard(portal.id)?.properties[PORTAL_BOARD_FIELD_ID]).toBe(target.id);
    // One commit: a single undo puts the old target back.
    workspace.undo();
    expect(workspace.getCard(portal.id)?.properties[PORTAL_BOARD_FIELD_ID]).toBe(
      workspace.listBoards().find((board) => board.name === "Other")?.id,
    );
    void before;
    void home;
  });

  it("clears the target, leaving the card as a portal with no board", () => {
    const { workspace, portal } = setup();
    workspace.setPortalTarget(portal.id, null);
    expect(workspace.getCard(portal.id)?.properties[PORTAL_BOARD_FIELD_ID]).toBeUndefined();
  });

  it("does nothing for a card that is gone", () => {
    const { workspace } = setup();
    expect(() => workspace.setPortalTarget("nope", null)).not.toThrow();
  });
});

describe("board template and cover", () => {
  it("keeps and clears a template flag", () => {
    const { workspace, other } = setup();
    workspace.setBoardTemplate(other.id, true);
    expect(workspace.getBoard(other.id)?.template).toBe(true);
    workspace.setBoardTemplate(other.id, false);
    expect(workspace.getBoard(other.id)?.template).toBeUndefined();
  });

  it("keeps and clears a cover", () => {
    const { workspace, other } = setup();
    workspace.setBoardCover(other.id, "attachment-1");
    expect(workspace.getBoard(other.id)?.coverAttachmentId).toBe("attachment-1");
    workspace.setBoardCover(other.id, null);
    expect(workspace.getBoard(other.id)?.coverAttachmentId).toBeUndefined();
  });
});
