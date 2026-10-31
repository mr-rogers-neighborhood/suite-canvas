import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { promoteAnnotation, titleFrom } from "./promote";

function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.ensureAnnotationStyles();
  const annotation = workspace.addAnnotation({
    sourceCardId: book.id,
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "2",
      quote: "The words.",
      prefix: "Before. ",
      suffix: " After.",
    },
    excerpt: "The words.",
  });
  return { workspace, board, book, annotation };
}

describe("promoting a highlight", () => {
  it("should make an ordinary card, placed where the reader dropped it", () => {
    const { workspace, board, annotation } = fixture();
    const promoted = promoteAnnotation({
      workspace,
      annotation,
      boardId: board.id,
      position: { x: 40, y: 60 },
    });

    expect(promoted).not.toBeNull();
    const card = workspace.getCard(promoted?.cardId ?? "");
    expect(card).toBeDefined();
    // An ordinary card: it has a placement, a title and a type, like anything a reader makes.
    expect(workspace.listPlacements().some((entry) => entry.cardId === card?.id)).toBe(true);
    expect(workspace.displayTitle(card?.id ?? "")).toBe("The words.");
  });

  it("should carry a read-only annotation property that names the record", () => {
    const { workspace, annotation } = fixture();
    const promoted = promoteAnnotation({ workspace, annotation });
    const card = workspace.getCard(promoted?.cardId ?? "");
    const type = workspace.getType(card?.primaryTypeId ?? "");
    const field = type?.fields.find((entry) => entry.kind === "annotation");

    expect(field).toBeDefined();
    expect(card?.properties[field?.id ?? ""]).toEqual({ annotationId: annotation.id });
  });

  it("should record the promotion on the highlight, so the book knows the passage left", () => {
    const { workspace, annotation } = fixture();
    const promoted = promoteAnnotation({ workspace, annotation });
    expect(workspace.getAnnotation(annotation.id)?.cardId).toBe(promoted?.cardId);
  });

  it("should leave the highlight alone when it deletes the card: the reader wrote the card", () => {
    const { workspace, annotation } = fixture();
    const promoted = promoteAnnotation({ workspace, annotation });
    workspace.deleteAnnotation(annotation.id);
    expect(workspace.getCard(promoted?.cardId ?? "")).toBeDefined();
  });

  it("should follow a style's template, which is how a colour becomes a kind of note", () => {
    const { workspace, annotation } = fixture();
    const claim = workspace.createType({ name: "Claim" });
    workspace.patchAnnotationStyle("style-yellow", { templateTypeId: claim.id });

    const promoted = promoteAnnotation({ workspace, annotation });
    expect(workspace.getCard(promoted?.cardId ?? "")?.primaryTypeId).toBe(claim.id);
  });

  it("should title a card from its style when the passage has no words of its own", () => {
    const { workspace, book } = fixture();
    const silent = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-blue",
      anchor: { kind: "time", locator: "episode 1", startMs: 0, endMs: 900 },
    });
    const promoted = promoteAnnotation({ workspace, annotation: silent });
    expect(promoted?.excerptMissing).toBe(true);
    expect(workspace.displayTitle(promoted?.cardId ?? "")).toBe("Reference");
  });
});

describe("a card's title from a passage", () => {
  it("should take the first sentence and keep it short enough to read on a card", () => {
    expect(titleFrom("One. Two.")).toBe("One.");
    expect(titleFrom("   spaced   out   words  ")).toBe("spaced out words");
    expect(titleFrom("")).toBe("Highlight");
    expect(titleFrom("a".repeat(80)).endsWith("…")).toBe(true);
    expect(titleFrom("a".repeat(80)).length).toBe(58);
  });
});
