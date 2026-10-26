import type { Card, GraphEdge } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { cardRollup, type RollupInput, rollupSummary } from "./rollup";

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

function edge(
  id: string,
  source: string,
  target: string,
  overrides: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    id,
    boardId: "board-1",
    source,
    target,
    kind: "references",
    path: "bezier",
    bidirectional: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function input(overrides: Partial<RollupInput> = {}): RollupInput {
  return {
    cardId: "summary",
    cards: [card("summary"), card("alpha"), card("beta")],
    edges: [edge("e1", "summary", "alpha")],
    references: { summary: ["beta"] },
    placements: [
      { boardId: "board-1", cardId: "summary", x: 0, y: 0, z: 0, createdAt: 0 },
      { boardId: "board-1", cardId: "alpha", x: 0, y: 0, z: 0, createdAt: 0 },
      { boardId: "board-2", cardId: "beta", x: 0, y: 0, z: 0, createdAt: 0 },
    ],
    activeBoardId: "board-1",
    titles: new Map([
      ["summary", "Reading list"],
      ["alpha", "Alpha"],
      ["beta", "Beta"],
    ]),
    typeNames: new Map([["note", "note"]]),
    ...overrides,
  };
}

describe("cardRollup", () => {
  it("should count exactly the members it lists", () => {
    const rollup = cardRollup(input());
    expect(rollup).not.toBeNull();
    expect(rollup?.count).toBe(rollup?.members.length);
    expect(rollup?.members.map((member) => member.cardId)).toEqual(["alpha", "beta"]);
  });

  it("should count a card once when a link and a mention both point at it", () => {
    const rollup = cardRollup(input({ references: { summary: ["beta", "alpha"] } }));
    expect(rollup?.count).toBe(2);
  });

  it("should not count the card itself", () => {
    const rollup = cardRollup(input({ references: { summary: ["summary", "beta"] } }));
    expect(rollup?.members.map((member) => member.cardId)).toEqual(["alpha", "beta"]);
    expect(rollup?.count).toBe(2);
  });

  it("should drop a trashed member and keep the count honest", () => {
    const rollup = cardRollup(
      input({ cards: [card("summary"), card("alpha", { deletedAt: 5 }), card("beta")] }),
    );
    expect(rollup?.members.map((member) => member.cardId)).toEqual(["beta"]);
    expect(rollup?.count).toBe(1);
  });

  it("should say how many members sit somewhere else", () => {
    const rollup = cardRollup(input());
    expect(rollup?.elsewhere).toBe(1);
    expect(rollup?.members.find((member) => member.cardId === "beta")?.boardId).toBe("board-2");
    expect(rollup?.members.find((member) => member.cardId === "beta")?.onBoard).toBe(false);
  });

  it("should count an inbox member as elsewhere", () => {
    const rollup = cardRollup(input({ placements: [] }));
    expect(rollup?.elsewhere).toBe(2);
  });

  it("should follow a bidirectional link in both directions", () => {
    const rollup = cardRollup(
      input({
        edges: [edge("e1", "alpha", "summary", { bidirectional: true })],
        references: {},
      }),
    );
    expect(rollup?.members.map((member) => member.cardId)).toEqual(["alpha"]);
  });

  it("should not treat a link to a board as a member", () => {
    const rollup = cardRollup(
      input({ edges: [edge("e1", "summary", "board-2", { targetKind: "board" })], references: {} }),
    );
    expect(rollup?.count).toBe(0);
  });

  it("should give a member whose title never arrived a name", () => {
    const rollup = cardRollup(input({ titles: new Map() }));
    expect(rollup?.members.map((member) => member.title)).toEqual(["Untitled", "Untitled"]);
  });

  it("should return null for a card that is gone or trashed", () => {
    expect(cardRollup(input({ cards: [] }))).toBeNull();
    expect(cardRollup(input({ cards: [card("summary", { deletedAt: 1 })] }))).toBeNull();
  });

  it("should order members by name, not by how they were found", () => {
    const byEdge = cardRollup(input({ references: { summary: ["beta"] } }));
    const byMention = cardRollup(input({ edges: [], references: { summary: ["beta", "alpha"] } }));
    expect(byMention?.members.map((member) => member.cardId)).toEqual(
      byEdge?.members.map((member) => member.cardId),
    );
  });
});

describe("rollupSummary", () => {
  it("should read the list it was given", () => {
    const rollup = cardRollup(input());
    if (!rollup) throw new Error("fixture produced no rollup");
    expect(rollupSummary(rollup)).toBe("2 cards · 1 elsewhere");
  });

  it("should use the singular for one card", () => {
    const rollup = cardRollup(
      input({
        edges: [],
        references: { summary: ["alpha"] },
        placements: [{ boardId: "board-1", cardId: "alpha", x: 0, y: 0, z: 0, createdAt: 0 }],
      }),
    );
    if (!rollup) throw new Error("fixture produced no rollup");
    expect(rollupSummary(rollup)).toBe("1 card");
  });

  it("should say nothing is there rather than show a zero", () => {
    const rollup = cardRollup(input({ references: {}, edges: [] }));
    if (!rollup) throw new Error("fixture produced no rollup");
    expect(rollupSummary(rollup)).toBe("Nothing to summarise");
  });
});
