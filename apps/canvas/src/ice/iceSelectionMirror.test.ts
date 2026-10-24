import type { Entity } from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import { mirrorSelection, selectionChanged, selectionKey } from "./iceSelectionMirror";

const entity = (id: number) => id as unknown as Entity;

describe("mirrorSelection", () => {
  it("should split the engine's entities into cards and links", () => {
    const cards = new Map([
      [entity(1), "card-1"],
      [entity(2), "card-2"],
    ]);
    const edges = new Map([[entity(9), "edge-1"]]);
    expect(
      mirrorSelection({
        entities: [entity(1), entity(9), entity(2)],
        cardOf: (picked) => cards.get(picked),
        edgeOf: (picked) => edges.get(picked),
      }),
    ).toEqual({ cards: ["card-1", "card-2"], edges: ["edge-1"] });
  });

  it("should mirror a link-only selection, which is what a picked line is", () => {
    expect(
      mirrorSelection({
        entities: [entity(9)],
        cardOf: () => undefined,
        edgeOf: () => "edge-1",
      }),
    ).toEqual({ cards: [], edges: ["edge-1"] });
  });

  it("should drop a non-card once it names no link, and never guess", () => {
    expect(
      mirrorSelection({ entities: [entity(4)], cardOf: () => undefined, edgeOf: () => undefined }),
    ).toEqual({ cards: [], edges: [] });
  });

  it("should keep one id per object when a card is placed twice", () => {
    const cards = new Map([
      [entity(1), "card-1"],
      [entity(2), "card-1"],
    ]);
    expect(
      mirrorSelection({
        entities: [entity(1), entity(2)],
        cardOf: (picked) => cards.get(picked),
        edgeOf: () => undefined,
      }),
    ).toEqual({ cards: ["card-1"], edges: [] });
  });

  it("should prefer the card when an entity somehow answers both", () => {
    expect(
      mirrorSelection({
        entities: [entity(1)],
        cardOf: () => "card-1",
        edgeOf: () => "edge-1",
      }),
    ).toEqual({ cards: ["card-1"], edges: [] });
  });
});

describe("selectionKey and selectionChanged", () => {
  it("should tell a link apart from a card and from nothing", () => {
    const none = selectionKey({ cards: [], edges: [] });
    const card = selectionKey({ cards: ["card-1"], edges: [] });
    const link = selectionKey({ cards: [], edges: ["edge-1"] });
    expect(new Set([none, card, link]).size).toBe(3);
  });

  it("should not report a first empty read as a change", () => {
    const none = selectionKey({ cards: [], edges: [] });
    expect(selectionChanged("", none)).toBe(false);
    expect(selectionChanged(none, none)).toBe(false);
  });

  it("should report a link pick, and the route back to nothing", () => {
    const none = selectionKey({ cards: [], edges: [] });
    const link = selectionKey({ cards: [], edges: ["edge-1"] });
    expect(selectionChanged(none, link)).toBe(true);
    expect(selectionChanged(link, none)).toBe(true);
  });
});
