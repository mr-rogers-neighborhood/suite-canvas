import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { colourPlan } from "../../entities/colour";
import { writeSelectionColour } from "./selectionColour";

/**
 * One press, every kind, one undo step.
 *
 * Each entity stores its colour in its own field, so the only interesting questions are whether a
 * mixed selection reaches all of them and whether undo takes the whole press back at once.
 */

function seed() {
  const doc = new WorkspaceDocument();
  const board = doc.createBoard({ name: "Home" });
  const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const other = doc.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
  const edge = doc.addEdge({
    boardId: board.id,
    source: card.id,
    target: other.id,
    kind: "relates-to",
  });
  if (!edge) throw new Error("a link between two placed cards is drawable");
  const section = doc.createSection({
    boardId: board.id,
    title: "Act",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  return { doc, card, other, edge, section };
}

describe("writeSelectionColour", () => {
  it("writes every kind in the plan", () => {
    const { doc, card, edge, section } = seed();
    const plan = colourPlan({ nodeIds: [card.id], edgeIds: [edge.id], sectionIds: [section.id] });

    writeSelectionColour(doc, plan, "green", new Map());

    expect(doc.getCard(card.id)?.style?.swatch).toBe("green");
    expect(doc.getEdge(edge.id)?.style?.swatch).toBe("green");
    expect(doc.getSection(section.id)?.color).toBe("green");
  });

  it("keeps the rest of a card's style and clears only the colour", () => {
    const { doc, card } = seed();
    doc.setCardStyle(card.id, { shape: "pill", swatch: "blue" });
    const plan = colourPlan({ nodeIds: [card.id], edgeIds: [], sectionIds: [] });

    writeSelectionColour(doc, plan, null, new Map([[card.id, { style: { shape: "pill" } }]]));

    expect(doc.getCard(card.id)?.style).toEqual({ shape: "pill" });
  });

  it("takes the whole press back in one undo step", () => {
    const { doc, card, edge, section } = seed();
    const plan = colourPlan({ nodeIds: [card.id], edgeIds: [edge.id], sectionIds: [section.id] });

    writeSelectionColour(doc, plan, "violet", new Map());
    doc.undo();

    expect(doc.getCard(card.id)?.style?.swatch).toBeUndefined();
    expect(doc.getEdge(edge.id)?.style?.swatch).toBeUndefined();
    expect(doc.getSection(section.id)?.color).toBeUndefined();
  });
});
