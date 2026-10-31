import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  type Annotation,
  type AnnotationAnchor,
  annotationsOf,
  annotationsWithin,
  DEFAULT_ANNOTATION_STYLES,
  sortedStyles,
} from "./annotations.js";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";

const QUOTE: AnnotationAnchor = {
  kind: "quote",
  locator: "2",
  quote: "A second sentence follows it.",
  prefix: "The first sentence of the book. ",
  suffix: " The same sentence",
};

function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  return { workspace, board, book };
}

function highlight(
  workspace: WorkspaceDocument,
  bookId: string,
  anchor: AnnotationAnchor = QUOTE,
  styleId = "style-yellow",
): Annotation {
  return workspace.addAnnotation({ sourceCardId: bookId, styleId, anchor });
}

describe("a highlight", () => {
  it("should read a schema-5 part that asked for a card of its own as part of the passage", () => {
    // Schema 5 had an `own-card` destination; schema 6 removed it so that one highlight means one card. A record that
    // fails the schema is a highlight the reader can no longer see, so the normalising reader repairs the target
    // instead: no migration script, one answer, and the words are already in the passage.
    const raw = new LoroDoc();
    const fields = raw.getMap("annotations").ensureMergeableMap("legacy");
    fields.set("sourceCardId", "book");
    fields.set("styleId", "style-yellow");
    fields.set("anchor", { ...QUOTE });
    fields.set("excerpt", "A second sentence follows it.");
    fields.set("createdAt", 1);
    fields.set("parts", [
      { id: "p1", start: 2, end: 8, target: { kind: "title" } },
      { id: "p2", start: 9, end: 17, target: { kind: "own-card" } },
    ]);
    raw.commit({ origin: "struct:init" });

    const doc = new WorkspaceDocument(raw);
    const read = doc.getAnnotation("legacy");

    expect(read).toBeDefined();
    expect(read?.parts?.map((part) => part.target)).toEqual([{ kind: "title" }, { kind: "body" }]);
  });

  it("should read a schema-5 recipe slot for a card of its own as the passage", () => {
    const raw = new LoroDoc();
    const style = raw.getMap("annotationStyles").ensureMergeableMap("legacy-style");
    style.set("name", "Old kind");
    style.set("color", "#f5d90a");
    style.set("order", 0);
    style.set("recipe", [{ kind: "title" }, { kind: "own-card" }]);
    raw.commit({ origin: "struct:init" });

    const doc = new WorkspaceDocument(raw);

    expect(doc.getAnnotationStyle("legacy-style")?.recipe).toEqual([
      { kind: "title" },
      { kind: "body" },
    ]);
  });

  it("should be recorded against its source, with its anchor and its style", () => {
    const { workspace, book } = fixture();
    const made = highlight(workspace, book.id);

    const stored = workspace.getAnnotation(made.id);
    expect(stored?.sourceCardId).toBe(book.id);
    expect(stored?.styleId).toBe("style-yellow");
    expect(stored?.anchor).toEqual(QUOTE);
    // Until it is promoted there is no card, which is the whole point of the record.
    expect(stored?.cardId).toBeUndefined();
  });

  it("should keep an excerpt the medium reported, and leave it absent when it did not", () => {
    const { workspace, book } = fixture();
    const withExcerpt = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-green",
      anchor: QUOTE,
      excerpt: "A second sentence follows it.",
    });
    expect(workspace.getAnnotation(withExcerpt.id)?.excerpt).toBe("A second sentence follows it.");

    const without = highlight(workspace, book.id);
    expect(workspace.getAnnotation(without.id)?.excerpt).toBeUndefined();
  });

  it("should list one source's highlights in the order they were made", () => {
    const { workspace, book } = fixture();
    const other = workspace.createCard();
    workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-yellow",
      anchor: QUOTE,
      createdAt: 2,
    });
    workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-green",
      anchor: { ...QUOTE, locator: "3" } as AnnotationAnchor,
      createdAt: 1,
    });
    workspace.addAnnotation({
      sourceCardId: other.id,
      styleId: "style-yellow",
      anchor: QUOTE,
      createdAt: 3,
    });

    expect(workspace.listAnnotationsOf(book.id).map((entry) => entry.createdAt)).toEqual([1, 2]);
    expect(workspace.listAnnotations()).toHaveLength(3);
  });

  it("should take a card when it is promoted, and keep the card when it is deleted", () => {
    const { workspace, book, board } = fixture();
    const made = highlight(workspace, book.id);
    const card = workspace.createCard({ boardId: board.id, position: { x: 10, y: 10 } });

    workspace.setAnnotationCard(made.id, card.id);
    expect(workspace.getAnnotation(made.id)?.cardId).toBe(card.id);

    // Deleting the highlight does not delete the card: the reader wrote that, and it is theirs.
    workspace.deleteAnnotation(made.id);
    expect(workspace.getAnnotation(made.id)).toBeUndefined();
    expect(workspace.getCard(card.id)).toBeDefined();
  });

  it("should forget the card when the reader takes it over", () => {
    const { workspace, book, board } = fixture();
    const made = highlight(workspace, book.id);
    const card = workspace.createCard({ boardId: board.id, position: { x: 10, y: 10 } });

    workspace.setAnnotationCard(made.id, card.id);
    expect(workspace.setAnnotationCard(made.id, null)?.cardId).toBeUndefined();
    expect(workspace.getAnnotation(made.id)?.cardId).toBeUndefined();
    // The highlight is still a highlight: de-linking is about the card, not about the passage.
    expect(workspace.getAnnotation(made.id)).toBeDefined();
  });

  it("should restyle without touching where it is", () => {
    const { workspace, book } = fixture();
    const made = highlight(workspace, book.id);

    workspace.setAnnotationStyle(made.id, "style-rose");
    expect(workspace.getAnnotation(made.id)?.styleId).toBe("style-rose");
    expect(workspace.getAnnotation(made.id)?.anchor).toEqual(QUOTE);
  });

  it("should be removed with its source, and report how many went", () => {
    const { workspace, book } = fixture();
    highlight(workspace, book.id);
    highlight(workspace, book.id);

    expect(workspace.deleteAnnotationsOf(book.id)).toBe(2);
    expect(workspace.listAnnotationsOf(book.id)).toEqual([]);
    expect(workspace.deleteAnnotationsOf(book.id)).toBe(0);
  });

  it("should tell a subscriber that a highlight arrived", () => {
    const { workspace, book } = fixture();
    let fired = 0;
    const stop = workspace.observeAnnotations(() => {
      fired += 1;
    });
    highlight(workspace, book.id);
    stop();
    highlight(workspace, book.id);
    expect(fired).toBe(1);
  });

  it("should accept a page anchor and a time anchor, which no medium renders yet", () => {
    // The union is written once, so the PDF and video work is a renderer and not a migration.
    const { workspace, book } = fixture();
    const page = highlight(workspace, book.id, {
      kind: "page",
      locator: "the report",
      page: 4,
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.01 }],
    });
    const time = highlight(workspace, book.id, {
      kind: "time",
      locator: "episode 1",
      startMs: 1000,
      endMs: 2500,
    });

    expect(workspace.getAnnotation(page.id)?.anchor.kind).toBe("page");
    expect(workspace.getAnnotation(time.id)?.anchor.kind).toBe("time");
  });

  it("should refuse an anchor with no words in it", () => {
    const { workspace, book } = fixture();
    expect(() =>
      workspace.addAnnotation({
        sourceCardId: book.id,
        styleId: "style-yellow",
        anchor: { ...QUOTE, quote: "" },
      }),
    ).toThrow();
  });

  it("should survive a reopen", () => {
    const { workspace, book } = fixture();
    const made = highlight(workspace, book.id);
    const bytes = workspace.doc.export({ mode: "update" });

    const reopened = new WorkspaceDocument();
    reopened.doc.import(bytes);
    expect(reopened.getAnnotation(made.id)?.anchor).toEqual(QUOTE);
  });
});

describe("the palette", () => {
  it("should seed four colours once and keep whatever the reader called them", () => {
    const { workspace } = fixture();
    const seeded = workspace.ensureAnnotationStyles();
    expect(seeded).toHaveLength(DEFAULT_ANNOTATION_STYLES.length);

    workspace.patchAnnotationStyle(seeded[0]?.id ?? "", { name: "Key claim" });
    // Seeding again must not overwrite a rename.
    workspace.ensureAnnotationStyles();
    expect(workspace.listAnnotationStyles()[0]?.name).toBe("Key claim");
  });

  it("should fall back to the defaults when a workspace has never set a palette", () => {
    const { workspace } = fixture();
    expect(workspace.listAnnotationStyles()).toEqual([...DEFAULT_ANNOTATION_STYLES]);
  });

  it("should add a colour, restyle it and remove it", () => {
    const { workspace } = fixture();
    workspace.ensureAnnotationStyles();
    const added = workspace.addAnnotationStyle({ name: "Musing", color: "#9999ff" });

    expect(workspace.listAnnotationStyles().at(-1)?.name).toBe("Musing");
    workspace.patchAnnotationStyle(added.id, { color: "#8888ee" });
    expect(workspace.getAnnotationStyle(added.id)?.color).toBe("#8888ee");

    workspace.deleteAnnotationStyle(added.id);
    expect(workspace.getAnnotationStyle(added.id)).toBeUndefined();
  });

  it("should let a colour name a template, which is how a style becomes a kind of note", () => {
    const { workspace } = fixture();
    workspace.ensureAnnotationStyles();
    const claim = workspace.createType({ name: "Claim" });
    const [first] = workspace.listAnnotationStyles();

    workspace.patchAnnotationStyle(first?.id ?? "", { templateTypeId: claim.id });
    expect(workspace.getAnnotationStyle(first?.id ?? "")?.templateTypeId).toBe(claim.id);

    // Clearing it is how a style goes back to the workspace's default type.
    workspace.patchAnnotationStyle(first?.id ?? "", { templateTypeId: null });
    expect(workspace.getAnnotationStyle(first?.id ?? "")?.templateTypeId).toBeUndefined();
  });

  it("should sort the palette by its own order, not by insertion", () => {
    const styles = [
      { id: "b", name: "B", color: "#000", order: 2 },
      { id: "a", name: "A", color: "#111", order: 1 },
    ];
    expect(sortedStyles(styles).map((style) => style.id)).toEqual(["a", "b"]);
  });
});

describe("a share's annotations", () => {
  const list: Annotation[] = [
    { id: "1", sourceCardId: "book", styleId: "s", anchor: QUOTE, createdAt: 1 },
    { id: "2", sourceCardId: "private", styleId: "s", anchor: QUOTE, createdAt: 2 },
  ];

  it("should carry only the highlights of sources inside the scope", () => {
    const { kept, withheld } = annotationsWithin(list, new Set(["book"]));
    expect(kept.map((entry) => entry.id)).toEqual(["1"]);
    // Reported rather than dropped quietly: a passage from an unshared source must never leak.
    expect(withheld).toBe(1);
  });

  it("should group one source's highlights in reading order", () => {
    expect(annotationsOf(list, "book").map((entry) => entry.id)).toEqual(["1"]);
  });
});

describe("a share and its annotations", () => {
  it("should carry a book's highlights into a projection of that book's board", async () => {
    const { projectWorkspace } = await import("./projection/workspace.js");
    const { workspace, book } = fixture();
    highlight(workspace, book.id);
    highlight(workspace, book.id);

    const projected = projectWorkspace(workspace, { scope: "card", cardId: book.id });
    expect(projected.workspace.listAnnotationsOf(book.id)).toHaveLength(2);
    expect(projected.withheldAnnotations).toBe(0);
    // The palette travels whole, so a highlight is not grey in a share.
    expect(projected.workspace.listAnnotationStyles().length).toBe(
      DEFAULT_ANNOTATION_STYLES.length,
    );
  });

  it("should withhold a highlight whose source is outside the share, and say how many", async () => {
    const { projectWorkspace } = await import("./projection/workspace.js");
    const { workspace, book } = fixture();
    const privateBook = workspace.createCard();
    highlight(workspace, book.id);
    highlight(workspace, privateBook.id);

    const projected = projectWorkspace(workspace, { scope: "card", cardId: book.id });
    expect(projected.workspace.listAnnotations().map((entry) => entry.sourceCardId)).toEqual([
      book.id,
    ]);
    expect(projected.withheldAnnotations).toBe(1);
  });
});
