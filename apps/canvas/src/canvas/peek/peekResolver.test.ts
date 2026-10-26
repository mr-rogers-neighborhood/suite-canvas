import type { Board, Card, GraphEdge, Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { type PeekSource, peekLabel, resolvePeek } from "./peekResolver";

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [],
    typeIds: ["note"],
    primaryTypeId: "note",
    tags: [],
    properties: {},
    ...overrides,
  };
}

const boards: Board[] = [
  { id: "board-1", name: "Research" },
  { id: "board-2", name: "" },
] as Board[];

const sections: Section[] = [
  {
    id: "section-1",
    boardId: "board-1",
    title: "Act one",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    z: 0,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

const edges: GraphEdge[] = [
  {
    id: "edge-1",
    boardId: "board-1",
    source: "alpha",
    target: "board-2",
    sourceKind: "card",
    targetKind: "board",
    kind: "references",
    path: "bezier",
    bidirectional: false,
    createdAt: 0,
    updatedAt: 0,
  } as GraphEdge,
];

function source(overrides: Partial<PeekSource> = {}): PeekSource {
  return {
    cards: [card("alpha"), card("beta", { deletedAt: 3 })],
    boards,
    sections,
    edges,
    placements: [
      { boardId: "board-1", cardId: "alpha", x: 0, y: 0, z: 0, createdAt: 0 },
      { boardId: "board-1", cardId: "gamma", x: 0, y: 0, z: 0, createdAt: 0 },
    ],
    titles: new Map([["alpha", "Retrieval beats re-reading"]]),
    typeNames: new Map([
      ["note", "note"],
      ["claim", "claim"],
    ]),
    ...overrides,
  };
}

describe("resolvePeek", () => {
  it("should name a card and say which board it sits on", () => {
    const peek = resolvePeek({ kind: "card", id: "alpha" }, source());
    expect(peek).toEqual({
      target: { kind: "card", id: "alpha" },
      label: "Retrieval beats re-reading",
      kindLabel: "note",
      detail: "On Research",
    });
  });

  it("should use the type name as the kind", () => {
    const peek = resolvePeek(
      { kind: "card", id: "alpha" },
      source({ cards: [card("alpha", { primaryTypeId: "claim", typeIds: ["claim"] })] }),
    );
    expect(peek?.kindLabel).toBe("claim");
  });

  it("should say a card is in the inbox when it has no placement", () => {
    const peek = resolvePeek({ kind: "card", id: "alpha" }, source({ placements: [] }));
    expect(peek?.detail).toBe("In the inbox");
  });

  it("should name a board and count the cards on it", () => {
    const peek = resolvePeek({ kind: "board", id: "board-1" }, source());
    expect(peek?.label).toBe("Research");
    expect(peek?.kindLabel).toBe("board");
    expect(peek?.detail).toBe("2 cards");
  });

  it("should name a section and its board", () => {
    const peek = resolvePeek({ kind: "section", id: "section-1" }, source());
    expect(peek?.label).toBe("Act one");
    expect(peek?.detail).toBe("On Research");
  });

  it("should resolve both ends of a link", () => {
    const peek = resolvePeek({ kind: "link", id: "edge-1" }, source());
    expect(peek?.kindLabel).toBe("references");
    expect(peek?.detail).toBe("Retrieval beats re-reading \u2192 Untitled board");
  });

  it("should return null for a kind it cannot describe", () => {
    expect(resolvePeek({ kind: "card", id: "missing" }, source())).toBeNull();
    expect(resolvePeek({ kind: "card", id: "beta" }, source())).toBeNull();
    expect(resolvePeek({ kind: "board", id: "missing" }, source())).toBeNull();
    expect(resolvePeek({ kind: "link", id: "missing" }, source())).toBeNull();
  });

  it("should read the same card the same way wherever it is asked from", () => {
    const fromOutline = resolvePeek({ kind: "card", id: "alpha" }, source());
    const fromRollup = resolvePeek({ kind: "card", id: "alpha" }, source());
    expect(fromRollup).toEqual(fromOutline);
  });

  it("should give the surface an accessible name", () => {
    const peek = resolvePeek({ kind: "card", id: "alpha" }, source());
    if (!peek) throw new Error("fixture produced no peek");
    expect(peekLabel(peek)).toBe("Retrieval beats re-reading, note");
  });
});
