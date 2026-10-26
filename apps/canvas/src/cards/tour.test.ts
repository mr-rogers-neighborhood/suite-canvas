import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { ensureTutorialType, tutorialCardOnBoard } from "./tour";

/**
 * A tutorial is an ordinary card of an ordinary type (ADR-0054 §1), so recording
 * has to find the one it already has rather than mint a second per entry
 * (ADR-0064 §9). These pin the two halves of that: the type is idempotent, and
 * the finder reads the board rather than the whole workspace.
 */

describe("the tutorial type", () => {
  it("should be minted once, named Tutorial", () => {
    const workspace = new WorkspaceDocument();
    const first = ensureTutorialType(workspace);
    const second = ensureTutorialType(workspace);

    expect(first.id).toBe(second.id);
    expect(first.name).toBe("Tutorial");
    expect(workspace.listTypes().filter((type) => type.name === "Tutorial")).toHaveLength(1);
  });
});

describe("the recording destination", () => {
  it("should find the tutorial card placed on this board", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    const note = workspace.createCard({ typeId: "note", boardId: board.id });
    const tutorial = workspace.createCard({
      typeId: ensureTutorialType(workspace).id,
      boardId: board.id,
    });

    expect(tutorialCardOnBoard(workspace, board.id)).toBe(tutorial.id);
    expect(note.id).not.toBe(tutorial.id);
  });

  it("should focus the tour already open, and otherwise the newest one", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    const typeId = ensureTutorialType(workspace).id;
    const first = workspace.createCard({ typeId, boardId: board.id });
    const second = workspace.createCard({ typeId, boardId: board.id });

    // No preference: the newest tour, because that is the one just made. Card
    // order is the CRDT's business, so asserting document order would pin a
    // detail nobody promised.
    expect(tutorialCardOnBoard(workspace, board.id)).toBe(second.id);
    // An open tour wins over that, whichever it is.
    expect(tutorialCardOnBoard(workspace, board.id, first.id)).toBe(first.id);
    expect(tutorialCardOnBoard(workspace, board.id, second.id)).toBe(second.id);
    // A preference for something that is not a tour on this board falls back.
    expect(tutorialCardOnBoard(workspace, board.id, "not-a-card")).toBe(second.id);
  });

  it("should ignore a tutorial that lives on another board", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    const other = workspace.createBoard({ name: "Elsewhere" });
    const tutorial = workspace.createCard({
      typeId: ensureTutorialType(workspace).id,
      boardId: other.id,
    });

    expect(tutorialCardOnBoard(workspace, board.id)).toBeNull();
    expect(tutorialCardOnBoard(workspace, other.id)).toBe(tutorial.id);
  });

  it("should ignore a trashed tutorial, so recording starts a fresh tour", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    const tutorial = workspace.createCard({
      typeId: ensureTutorialType(workspace).id,
      boardId: board.id,
    });

    workspace.trashCard(tutorial.id);

    expect(tutorialCardOnBoard(workspace, board.id)).toBeNull();
  });
});
