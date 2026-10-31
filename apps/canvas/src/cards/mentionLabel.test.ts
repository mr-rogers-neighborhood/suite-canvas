import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { mentionLabelIn } from "./mentionLabel";

/**
 * Naming a reference without an editor.
 *
 * The resolver is what the static card face asks, so its answers are what a reader sees on the board: a name, or a
 * plain statement that the target is gone. Never an id, and never "Not shared" for a card that is simply missing.
 */
function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText(book.id, "A Small Book");
  workspace.ensureAnnotationStyles();
  return { workspace, board, book };
}

describe("naming a mention", () => {
  it("should use a live card's title", () => {
    const { workspace, book } = fixture();
    expect(mentionLabelIn(workspace)({ cardId: book.id })).toBe("A Small Book");
  });

  it("should fall back to the body's first line for a card with no title", () => {
    const { workspace, board } = fixture();
    const untitled = workspace.createCard({ boardId: board.id, position: { x: 100, y: 0 } });
    workspace.setBodyText(untitled.id, "A first line worth naming it");
    expect(mentionLabelIn(workspace)({ cardId: untitled.id })).toContain("A first line");
  });

  it("should say a card is unavailable rather than print its id", () => {
    const { workspace } = fixture();
    expect(mentionLabelIn(workspace)({ cardId: "gone" })).toBe("Unavailable card");
  });

  it("should say a trashed card is unavailable", () => {
    const { workspace, book } = fixture();
    workspace.trashCard(book.id);
    expect(mentionLabelIn(workspace)({ cardId: book.id })).toBe("Unavailable card");
  });

  it("should name a passage by its excerpt", () => {
    const { workspace, book } = fixture();
    const annotation = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-yellow",
      anchor: { kind: "quote", locator: "1", quote: "The words.", prefix: "", suffix: "" },
      excerpt: "The words that mattered.",
    });
    expect(mentionLabelIn(workspace)({ annotationId: annotation.id })).toBe(
      "The words that mattered.",
    );
  });

  it("should shorten a long passage so the chip stays a chip", () => {
    const { workspace, book } = fixture();
    const annotation = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-yellow",
      anchor: {
        kind: "quote",
        locator: "1",
        quote:
          "A sentence that goes on and on and on well past the width of any chip that could hold it comfortably.",
        prefix: "",
        suffix: "",
      },
    });
    const label = mentionLabelIn(workspace)({ annotationId: annotation.id }) ?? "";
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.endsWith("…")).toBe(true);
  });

  it("should say a passage is unavailable when the highlight is gone", () => {
    const { workspace } = fixture();
    expect(mentionLabelIn(workspace)({ annotationId: "gone" })).toBe("Unavailable passage");
  });

  it("should have no opinion when there is no document", () => {
    // Null is the signal to fall back to the label the node stored, which is all a projection has.
    expect(mentionLabelIn(null)({ cardId: "anything" })).toBeNull();
  });

  it("should have no opinion about a mention that names nothing", () => {
    const { workspace } = fixture();
    expect(mentionLabelIn(workspace)({})).toBeNull();
  });
});
