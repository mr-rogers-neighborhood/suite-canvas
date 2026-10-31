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

describe("what a promoted card says", () => {
  it("should open with the quote and then name where it came from", () => {
    const { workspace, annotation, book } = fixture();
    workspace.setTitleText(book.id, "A Small Book");
    const promoted = promoteAnnotation({ workspace, annotation });
    const nodes = workspace.bodyNodes(promoted?.cardId ?? "");

    expect(nodes[0]?.type).toBe("blockquote");
    expect(nodes[0]?.content?.[0]?.content?.[0]).toEqual({ type: "text", text: "The words." });
    // The reference is the source card itself, so the backlink is the graph's own mechanism.
    expect(nodes[1]?.content?.some((node) => node.type === "mention")).toBe(true);
    expect(
      nodes[1]?.content?.some(
        (node) => node.type === "text" && (node.text ?? "").includes("A Small Book"),
      ),
    ).toBe(true);
  });

  it("should carry no quote block when the passage had no words", () => {
    const { workspace, book } = fixture();
    const silent = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-blue",
      anchor: { kind: "time", locator: "episode 1", startMs: 0, endMs: 900 },
    });
    const promoted = promoteAnnotation({ workspace, annotation: silent });
    const nodes = workspace.bodyNodes(promoted?.cardId ?? "");

    expect(nodes.map((node) => node.type)).toEqual(["paragraph"]);
    // No words to quote, but the way back to the recording is still a reference rather than a sentence.
    expect(nodes[0]?.content?.some((node) => node.type === "mention")).toBe(true);
  });

  it("should make a real reference, so the card and the book know each other", () => {
    const { workspace, annotation, book } = fixture();
    const promoted = promoteAnnotation({ workspace, annotation });
    workspace.ensureReferences();

    // A reference is the graph's own direction: the card points at the book, which is what makes a backlink.
    expect(workspace.referencesFor(promoted?.cardId ?? "")).toContain(book.id);
  });
});

describe("parts of a highlight", () => {
  const QUOTE = "The thing that matters here is what we call the domain.";

  function partsFixture() {
    const { workspace, book } = fixture();
    // A highlight long enough to break apart, with "the domain" at the end: exactly the case that titling from the
    // first words gets wrong.
    const long = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-yellow",
      anchor: { kind: "quote", locator: "1", quote: QUOTE, prefix: "", suffix: "" },
      excerpt: QUOTE,
    });
    const start = QUOTE.indexOf("the domain");
    workspace.setAnnotationParts(long.id, [
      { id: "part-title", start, end: start + "the domain".length, target: { kind: "title" } },
      {
        id: "part-field",
        start: 0,
        end: "The thing that matters here".length,
        target: { kind: "field", name: "Question" },
      },
    ]);
    return { workspace, book, annotation: workspace.getAnnotation(long.id) ?? long };
  }

  it("should title the card from the part the reader marked, not from the first words", () => {
    const { workspace, annotation } = partsFixture();
    const promoted = promoteAnnotation({ workspace, annotation });
    expect(workspace.displayTitle(promoted?.cardId ?? "")).toBe("the domain");
  });

  it("should fill a named property, creating it on the type when it is missing", () => {
    const { workspace, annotation } = partsFixture();
    const promoted = promoteAnnotation({ workspace, annotation });
    const card = workspace.getCard(promoted?.cardId ?? "");
    const field = workspace
      .getType(card?.primaryTypeId ?? "")
      ?.fields.find((entry) => entry.name === "Question");

    expect(field?.kind).toBe("text");
    expect(card?.properties[field?.id ?? ""]).toBe("The thing that matters here");
  });

  it("should keep the whole passage in the body, because parts carve pieces out of what was marked", () => {
    const { workspace, annotation } = partsFixture();
    const promoted = promoteAnnotation({ workspace, annotation });
    const quote = workspace.bodyNodes(promoted?.cardId ?? "")[0];

    expect(quote?.type).toBe("blockquote");
    expect(quote?.content?.[0]?.content?.[0]?.text).toBe(QUOTE);
  });

  it("should make a card per own-card part, all pointing at the same highlight", () => {
    const { workspace, annotation } = partsFixture();
    const start = QUOTE.indexOf("what we call");
    workspace.setAnnotationParts(annotation.id, [
      ...(annotation.parts ?? []),
      { id: "part-own", start, end: start + "what we call".length, target: { kind: "own-card" } },
    ]);
    const promoted = promoteAnnotation({
      workspace,
      annotation: workspace.getAnnotation(annotation.id) ?? annotation,
    });

    expect(promoted?.ownCardIds).toHaveLength(1);
    const own = workspace.getCard(promoted?.ownCardIds[0] ?? "");
    expect(workspace.displayTitle(own?.id ?? "")).toBe("what we call");
  });

  it("should open the card a highlight already has instead of making a second one", () => {
    const { workspace, annotation } = partsFixture();
    const first = promoteAnnotation({ workspace, annotation });
    const second = promoteAnnotation({
      workspace,
      annotation: workspace.getAnnotation(annotation.id) ?? annotation,
    });

    expect(second?.existed).toBe(true);
    expect(second?.cardId).toBe(first?.cardId);
    expect(workspace.getCard(first?.cardId ?? "")).toBeDefined();
  });

  it("should make another card when the reader asks for one deliberately", () => {
    const { workspace, annotation } = partsFixture();
    const first = promoteAnnotation({ workspace, annotation });
    const second = promoteAnnotation({
      workspace,
      annotation: workspace.getAnnotation(annotation.id) ?? annotation,
      again: true,
    });

    expect(second?.existed).toBe(false);
    expect(second?.cardId).not.toBe(first?.cardId);
    // The record names the newest card; the first is still a card the reader has.
    expect(workspace.getAnnotation(annotation.id)?.cardId).toBe(second?.cardId);
    expect(workspace.getCard(first?.cardId ?? "")).toBeDefined();
  });
});
