import { propertySources, WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { promoteAnnotation, titleFrom } from "./promote";

/** The two calls that name no board: everything a highlight makes arrives unplaced, and only a gesture puts it down. */
function INBOX(
  workspace: WorkspaceDocument,
  annotation: Parameters<typeof promoteAnnotation>[0]["annotation"],
) {
  return { workspace, annotation, placement: { inbox: true as const } };
}

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
      placement: { onBoard: { boardId: board.id, position: { x: 40, y: 60 } } },
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
    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    const card = workspace.getCard(promoted?.cardId ?? "");
    const type = workspace.getType(card?.primaryTypeId ?? "");
    const field = type?.fields.find((entry) => entry.kind === "annotation");

    expect(field).toBeDefined();
    expect(card?.properties[field?.id ?? ""]).toEqual({ annotationId: annotation.id });
  });

  it("should record the promotion on the highlight, so the book knows the passage left", () => {
    const { workspace, annotation } = fixture();
    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    expect(workspace.getAnnotation(annotation.id)?.cardId).toBe(promoted?.cardId);
  });

  it("should leave the highlight alone when it deletes the card: the reader wrote the card", () => {
    const { workspace, annotation } = fixture();
    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    workspace.deleteAnnotation(annotation.id);
    expect(workspace.getCard(promoted?.cardId ?? "")).toBeDefined();
  });

  it("should follow a style's template, which is how a colour becomes a kind of note", () => {
    const { workspace, annotation } = fixture();
    const claim = workspace.createType({ name: "Claim" });
    workspace.patchAnnotationStyle("style-yellow", { templateTypeId: claim.id });

    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    expect(workspace.getCard(promoted?.cardId ?? "")?.primaryTypeId).toBe(claim.id);
  });

  it("should title a card from its style when the passage has no words of its own", () => {
    const { workspace, book } = fixture();
    const silent = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-blue",
      anchor: { kind: "time", locator: "episode 1", startMs: 0, endMs: 900 },
    });
    const promoted = promoteAnnotation(INBOX(workspace, silent));
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
  it("should write no body at all, because the type's template owns it", () => {
    const { workspace, annotation } = fixture();
    const promoted = promoteAnnotation(INBOX(workspace, annotation));

    // The passage is the strip above the body (`AnnotationCardFace`) and the read-only property. A body written here
    // would overwrite whatever the type's template put in one.
    expect(workspace.bodyNodes(promoted?.cardId ?? "")).toEqual([]);
    expect(workspace.cardText(promoted?.cardId ?? "")).toBe("");
  });

  it("should keep the body a type's template supplied", () => {
    const { workspace, annotation } = fixture();
    const claim = workspace.createType({ name: "Claim" });
    const template = workspace.createCard({ typeId: claim.id, fromTemplate: false });
    workspace.setTitleText(template.id, "A claim worth making");
    workspace.setBodyText(template.id, "State the claim, then the evidence.");
    workspace.updateType(claim.id, { templateCardIds: [template.id] });
    workspace.patchAnnotationStyle("style-yellow", { templateTypeId: claim.id });

    const promoted = promoteAnnotation(INBOX(workspace, annotation));

    expect(workspace.cardText(promoted?.cardId ?? "")).toBe("State the claim, then the evidence.");
    // The template's title stands too, because the reader authored it for this kind of card.
    expect(workspace.displayTitle(promoted?.cardId ?? "")).toBe("A claim worth making");
  });

  it("should name the book with a Source property, which is what a backlink is", () => {
    const { workspace, annotation, book } = fixture();
    workspace.setTitleText(book.id, "A Small Book");
    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    const card = workspace.getCard(promoted?.cardId ?? "");
    const field = workspace
      .getType(card?.primaryTypeId ?? "")
      ?.fields.find((entry) => entry.name === "Source");

    expect(field?.kind).toBe("card");
    expect(card?.properties[field?.id ?? ""]).toBe(book.id);
    // A mention lives in the body and the body belongs to the template, so the link is a card-valued property. That is
    // the shape `propertySources` reads as a link, which is what puts the card in the book's Links list.
    const sources = propertySources(book.id, workspace.listCards(), workspace.listTypes());
    expect(sources.some((source) => source.cardId === card?.id)).toBe(true);
    expect(sources.find((source) => source.cardId === card?.id)?.fieldName).toBe("Source");
  });

  it("should reuse a Source field the type already has, and never clobber one that is not a link", () => {
    const { workspace, annotation } = fixture();
    const claim = workspace.createType({ name: "Claim" });
    const existing = workspace.addField(claim.id, { name: "source", kind: "card" });
    workspace.patchAnnotationStyle("style-yellow", { templateTypeId: claim.id });

    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    const card = workspace.getCard(promoted?.cardId ?? "");
    // One field named Source, the one the type already had — case-insensitively, and not a second one.
    expect(
      workspace.getType(claim.id)?.fields.filter((field) => field.name.toLowerCase() === "source"),
    ).toHaveLength(1);
    expect(card?.properties[existing.id]).toBe(annotation.sourceCardId);
  });

  it("should leave a title the type's template supplied alone, and let a mapped part win over it", () => {
    const { workspace, annotation } = fixture();
    const claim = workspace.createType({ name: "Claim" });
    const template = workspace.createCard({ typeId: claim.id, fromTemplate: false });
    workspace.setTitleText(template.id, "A claim worth making");
    workspace.updateType(claim.id, { templateCardIds: [template.id] });
    workspace.patchAnnotationStyle("style-yellow", { templateTypeId: claim.id });

    const plain = promoteAnnotation(INBOX(workspace, annotation));
    expect(workspace.displayTitle(plain?.cardId ?? "")).toBe("A claim worth making");

    // A second highlight of the same kind, with the reader having mapped "words" to the title: the part wins, because
    // the reader said which words the card is about and the template could not know.
    const other = workspace.addAnnotation({
      sourceCardId: annotation.sourceCardId,
      styleId: "style-yellow",
      anchor: { kind: "quote", locator: "2", quote: "The words.", prefix: "", suffix: "" },
      excerpt: "The words.",
    });
    workspace.setAnnotationParts(other.id, [
      { id: "p1", start: 4, end: 9, target: { kind: "title" } },
    ]);
    const mapped = promoteAnnotation(INBOX(workspace, other));
    expect(workspace.displayTitle(mapped?.cardId ?? "")).toBe("words");
  });

  it("should take the passage's first sentence when there is neither a part nor a template", () => {
    const { workspace, annotation } = fixture();
    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    expect(workspace.displayTitle(promoted?.cardId ?? "")).toBe("The words.");
  });

  it("should be one gesture to undo, not six", () => {
    const { workspace, annotation } = fixture();
    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    const cardId = promoted?.cardId ?? "";
    expect(workspace.getCard(cardId)).toBeDefined();

    workspace.undo();

    // One press, one step: the card, its properties, its title and the record's link all leave together.
    expect(workspace.getCard(cardId)).toBeUndefined();
    expect(workspace.getAnnotation(annotation.id)?.cardId).toBeUndefined();
  });

  it("should make no second card for a highlight whose card is in the trash, and say so", () => {
    const { workspace, annotation } = fixture();
    const first = promoteAnnotation(INBOX(workspace, annotation));
    workspace.trashCard(first?.cardId ?? "");

    const again = promoteAnnotation(
      INBOX(workspace, workspace.getAnnotation(annotation.id) ?? annotation),
    );

    expect(again?.trashed).toBe(true);
    expect(again?.existed).toBe(true);
    expect(again?.cardId).toBe(first?.cardId);
    // The record still names the card the reader made: restoring it from the library brings it back, linked.
    expect(workspace.getAnnotation(annotation.id)?.cardId).toBe(first?.cardId);
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
    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    expect(workspace.displayTitle(promoted?.cardId ?? "")).toBe("the domain");
  });

  it("should fill a named property, creating it on the type when it is missing", () => {
    const { workspace, annotation } = partsFixture();
    const promoted = promoteAnnotation(INBOX(workspace, annotation));
    const card = workspace.getCard(promoted?.cardId ?? "");
    const field = workspace
      .getType(card?.primaryTypeId ?? "")
      ?.fields.find((entry) => entry.name === "Question");

    expect(field?.kind).toBe("text");
    expect(card?.properties[field?.id ?? ""]).toBe("The thing that matters here");
  });

  it("should keep the whole passage on the card, because parts carve pieces out of what was marked", () => {
    const { workspace, annotation } = partsFixture();
    const promoted = promoteAnnotation(INBOX(workspace, annotation));

    // The strip above the body reads the record, so carving a part out cannot shorten what the card shows.
    expect(workspace.getAnnotation(annotation.id)?.excerpt).toBe(QUOTE);
    expect(workspace.bodyNodes(promoted?.cardId ?? "")).toEqual([]);
  });

  it("should make one card however many parts the passage is cut into", () => {
    const { workspace, annotation } = partsFixture();
    const start = QUOTE.indexOf("what we call");
    workspace.setAnnotationParts(annotation.id, [
      ...(annotation.parts ?? []),
      {
        id: "part-field",
        start,
        end: start + "what we call".length,
        target: { kind: "field", name: "Question" },
      },
    ]);
    const before = workspace.listCards().length;
    const promoted = promoteAnnotation(
      INBOX(workspace, workspace.getAnnotation(annotation.id) ?? annotation),
    );

    // One press, one card: the number a promotion makes no longer depends on the mapping.
    expect(workspace.listCards()).toHaveLength(before + 1);
    expect(workspace.getCard(promoted?.cardId ?? "")).toBeDefined();
    // Every word is still in the passage, so nothing was dropped by mapping part of it.
    expect(workspace.getAnnotation(annotation.id)?.excerpt).toBe(QUOTE);
  });

  it("should open the card a highlight already has instead of making a second one", () => {
    const { workspace, annotation } = partsFixture();
    const first = promoteAnnotation(INBOX(workspace, annotation));
    const second = promoteAnnotation(
      INBOX(workspace, workspace.getAnnotation(annotation.id) ?? annotation),
    );

    expect(second?.existed).toBe(true);
    expect(second?.cardId).toBe(first?.cardId);
    expect(workspace.getCard(first?.cardId ?? "")).toBeDefined();
  });

  it("should never orphan a card by writing a second link over the first", () => {
    const { workspace, annotation } = partsFixture();
    const first = promoteAnnotation(INBOX(workspace, annotation));
    const second = promoteAnnotation(
      INBOX(workspace, workspace.getAnnotation(annotation.id) ?? annotation),
    );

    // There is no flag to ask for another card, and no path that makes one behind the reader's back.
    expect(second?.cardId).toBe(first?.cardId);
    expect(workspace.getAnnotation(annotation.id)?.cardId).toBe(first?.cardId);
  });
});
