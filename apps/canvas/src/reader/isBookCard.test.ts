import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { isBookCard } from "./isBookCard";

/**
 * What focus mode branches on.
 *
 * A card holds a book because its body holds a `media` block of kind `epub`, not because of its type: a type is the
 * reader's to rename and retype, and a book that stopped opening because a type was renamed would be a strange thing
 * to explain.
 */
function screenshot(cards: (workspace: WorkspaceDocument, boardId: string) => string) {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  return { workspace, cardId: cards(workspace, board.id) };
}

describe("deciding whether a card is a book", () => {
  it("should say yes for a card whose body holds an epub block", () => {
    const { workspace, cardId } = screenshot((doc, boardId) => {
      const card = doc.createCard({ boardId, position: { x: 0, y: 0 } });
      doc.setBodyNodes(card.id, [
        {
          type: "media",
          attrs: { kind: "epub", id: "a".repeat(32), mime: "application/epub+zip" },
        },
      ]);
      return card.id;
    });
    expect(isBookCard(workspace, cardId)).toBe(true);
  });

  it("should say no for a card holding a picture, a video or nothing", () => {
    const { workspace, cardId } = screenshot((doc, boardId) => {
      const card = doc.createCard({ boardId, position: { x: 0, y: 0 } });
      doc.setBodyNodes(card.id, [{ type: "media", attrs: { kind: "image", id: "b".repeat(32) } }]);
      return card.id;
    });
    expect(isBookCard(workspace, cardId)).toBe(false);

    const { workspace: other, cardId: empty } = screenshot((doc, boardId) => {
      const card = doc.createCard({ boardId, position: { x: 0, y: 0 } });
      return card.id;
    });
    expect(isBookCard(other, empty)).toBe(false);
  });

  it("should say no rather than throw when there is no workspace yet", () => {
    expect(isBookCard(null, "card-1")).toBe(false);
  });
});
