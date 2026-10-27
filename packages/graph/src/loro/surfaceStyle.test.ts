import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

/** A document with one board on it: a workspace does not seed a board by itself. */
function workspace() {
  const doc = new WorkspaceDocument();
  const board = doc.createBoard({ name: "Paint" });
  return { doc, board };
}

describe("surface styles", () => {
  it("writes a style on a card and reads it back through the snapshot", () => {
    const { doc, board } = workspace();
    const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });

    doc.setCardStyle(card.id, { shape: "pill", textScale: 1.4 });

    expect(doc.getCard(card.id)?.style).toEqual({ shape: "pill", textScale: 1.4 });
    expect(doc.listCards().find((entry) => entry.id === card.id)?.style).toEqual({
      shape: "pill",
      textScale: 1.4,
    });
  });

  it("drops an empty record rather than storing a style that says nothing", () => {
    const { doc, board } = workspace();
    const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });

    doc.setCardStyle(card.id, { shape: "circle" });
    expect(doc.getCard(card.id)?.style).toBeDefined();

    doc.setCardStyle(card.id, {});
    expect(doc.getCard(card.id)?.style).toBeUndefined();

    doc.setCardStyle(card.id, { icon: "lucide:star" });
    doc.setCardStyle(card.id, null);
    expect(doc.getCard(card.id)?.style).toBeUndefined();
  });

  it("refuses a style that names a colour value instead of a role", () => {
    const { doc, board } = workspace();
    const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });

    // `surface` only accepts roles; a hex value is a schema error, not a paint.
    expect(() => doc.setCardStyle(card.id, { surface: "#ff0000" as never })).toThrow();
    expect(doc.getCard(card.id)?.style).toBeUndefined();
  });

  it("styles a link independently of the cards it joins", () => {
    const { doc, board } = workspace();
    const from = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const to = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const edge = doc.addEdge({
      boardId: board.id,
      source: from.id,
      target: to.id,
      kind: "relates-to",
    });
    if (!edge) throw new Error("a link between two placed cards is drawable");

    doc.setEdgeStyle(edge.id, { ink: "accent", sides: { top: { paint: "dotted" } } });

    // A section and a board carry no style at all: they read the theme.
    expect(doc.getEdge(edge.id)?.style?.ink).toBe("accent");
    expect(doc.getCard(from.id)?.style).toBeUndefined();
  });

  it("keeps a link's bends and layer, and clears them again", () => {
    const { doc, board } = workspace();
    const from = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const to = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const edge = doc.addEdge({
      boardId: board.id,
      source: from.id,
      target: to.id,
      kind: "relates-to",
    });
    if (!edge) throw new Error("a link between two placed cards is drawable");

    doc.setEdgeRoute(edge.id, {
      bends: [
        { x: 40, y: -20 },
        { x: 80, y: -20 },
      ],
      layer: "above",
    });
    expect(doc.getEdge(edge.id)?.bends).toEqual([
      { x: 40, y: -20 },
      { x: 80, y: -20 },
    ]);
    expect(doc.getEdge(edge.id)?.layer).toBe("above");

    // `below` is the default, so it is not stored.
    doc.setEdgeRoute(edge.id, { layer: "below" });
    expect(doc.getEdge(edge.id)?.layer).toBeUndefined();
    expect(doc.getEdge(edge.id)?.bends).toBeUndefined();
  });

  it("survives a reload: the style is in the document, not in UI state", () => {
    const { doc, board } = workspace();
    const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    doc.setCardStyle(card.id, { opacity: 0.5 });

    const reopened = new WorkspaceDocument();
    reopened.importSnapshot(doc.exportSnapshot());
    expect(reopened.getCard(card.id)?.style?.opacity).toBe(0.5);
  });
});

describe("primary type under supertags", () => {
  it("setPrimaryType keeps the other types a card carries", () => {
    const { doc, board } = workspace();
    const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const concept = doc.createType({ name: "Concept", glyph: "◇" });
    const source = doc.createType({ name: "Source", glyph: "▤" });
    doc.setCardTypes(card.id, [concept.id, source.id], concept.id);

    // Making another type primary must not drop the first one: a palette row that
    // says "set type" is a choice of presentation, not a replacement of schema.
    doc.setPrimaryType(card.id, source.id);
    const after = doc.getCard(card.id);
    expect(after?.primaryTypeId).toBe(source.id);
    expect(after?.typeIds.slice().sort()).toEqual([concept.id, source.id].sort());
  });
});

describe("a type's own paint", () => {
  it("carries the default for every card of the type, and clears again", () => {
    const { doc, board } = workspace();
    const type = doc.createType({ name: "Source", glyph: "\u25a4" });
    const card = doc.createCard({
      boardId: board.id,
      position: { x: 0, y: 0 },
      primaryTypeId: type.id,
    });

    doc.updateType(type.id, { style: { surface: "accent", shape: "pill" } });

    // The default lives on the type, not on each card: a card created after the
    // change reads it without anything being written to the card.
    expect(doc.getType(type.id)?.style).toEqual({ surface: "accent", shape: "pill" });
    expect(doc.getCard(card.id)?.style).toBeUndefined();

    doc.updateType(type.id, { style: null });
    expect(doc.getType(type.id)?.style).toBeUndefined();
  });

  it("drops a style that names nothing rather than storing an empty record", () => {
    const { doc } = workspace();
    const type = doc.createType({ name: "Source", glyph: "\u25a4" });

    doc.updateType(type.id, { style: {} });

    expect(doc.getType(type.id)?.style).toBeUndefined();
  });

  it("refuses a colour value where a role belongs, the same as a card", () => {
    const { doc } = workspace();
    const type = doc.createType({ name: "Source", glyph: "\u25a4" });

    expect(() => doc.updateType(type.id, { style: { surface: "#ff0000" as never } })).toThrow();
  });
});
