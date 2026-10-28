import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

/**
 * Two portals to one board on one board is one portal too many: it says the same thing
 * twice, and it is what a placement used to make when a board already had one.
 */
function fixture() {
  const workspace = new WorkspaceDocument();
  const home = workspace.createBoard({ name: "Home" });
  const away = workspace.createBoard({ name: "Away" });
  const other = workspace.createBoard({ name: "Other" });
  const portal = (boardId: string, target: string) =>
    workspace.createPortalCard({ boardId, targetBoardId: target, position: { x: 0, y: 0 } });
  return { workspace, home, away, other, portal };
}

describe("portals", () => {
  it("keeps the earliest of two portals to the same board", () => {
    const { workspace, home, away, portal } = fixture();
    const first = portal(home.id, away.id);
    const second = portal(home.id, away.id);

    expect(workspace.pruneDuplicatePortals()).toBe(1);

    const live = workspace.listBoardCards(home.id).map((card) => card.id);
    expect(live).toContain(first.id);
    expect(live).not.toContain(second.id);
    // Trashed, not gone: the reader can get it back.
    expect(workspace.listTrashedCards().map((card) => card.id)).toContain(second.id);
  });

  it("keeps one portal per host board, because two boards open independently", () => {
    const { workspace, home, away, other, portal } = fixture();
    portal(home.id, away.id);
    portal(other.id, away.id);

    expect(workspace.pruneDuplicatePortals()).toBe(0);
    expect(workspace.listBoardCards(home.id)).toHaveLength(1);
    expect(workspace.listBoardCards(other.id)).toHaveLength(1);
  });

  it("leaves ordinary cards alone", () => {
    const { workspace, home } = fixture();
    workspace.createCard({ boardId: home.id, position: { x: 0, y: 0 } });
    workspace.createCard({ boardId: home.id, position: { x: 400, y: 0 } });

    expect(workspace.pruneDuplicatePortals()).toBe(0);
    expect(workspace.listBoardCards(home.id)).toHaveLength(2);
  });
});
