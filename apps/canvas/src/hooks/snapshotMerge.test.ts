import type { Card, GraphEdge, Placement } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  mergeSnapshots,
  reuseArray,
  reuseReferences,
  type WorkspaceSnapshot,
} from "./snapshotMerge";

const card = (id: string): Card => ({
  id,
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["note"],
  primaryTypeId: "note",
  tags: [],
  properties: {},
});

const placement = (cardId: string): Placement => ({
  boardId: "b1",
  cardId,
  x: 0,
  y: 0,
  z: 0,
  createdAt: 0,
});

const edge = (id: string): GraphEdge => ({
  id,
  boardId: "b1",
  source: "a",
  target: "b",
  kind: "references",
  path: "bezier",
  bidirectional: false,
  createdAt: 0,
  updatedAt: 0,
});

/** Builds a snapshot, reusing `base`'s untouched collections like a real read. */
function snapshot(cards: Card[], base?: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    boards: base?.boards ?? [],
    views: base?.views ?? [],
    cards,
    placements: base?.placements ?? cards.map((entry) => placement(entry.id)),
    edges: base?.edges ?? [edge("e1")],
    types: base?.types ?? [],
    tags: base?.tags ?? [],
    sections: base?.sections ?? [],
    references: base?.references ?? {},
  };
}

describe("reuseArray", () => {
  it("keeps the previous array when nothing changed", () => {
    const first = [card("a"), card("b")];
    expect(reuseArray(first, [first[0] as Card, first[1] as Card])).toBe(first);
  });

  it("returns the new array when an element changed", () => {
    const first = [card("a"), card("b")];
    const second = [first[0] as Card, card("b")];
    expect(reuseArray(first, second)).toBe(second);
  });

  it("returns the new array when the length changed", () => {
    const first = [card("a")];
    const second = [first[0] as Card, card("b")];
    expect(reuseArray(first, second)).toBe(second);
  });
});

describe("mergeSnapshots", () => {
  it("returns the same snapshot when no record identity moved", () => {
    const base = snapshot([card("a"), card("b")]);
    expect(mergeSnapshots(base, snapshot([...base.cards], base))).toBe(base);
  });

  it("replaces only the collection that changed", () => {
    const base = snapshot([card("a"), card("b")]);
    const changed = snapshot([base.cards[0] as Card, card("b")], base);

    const merged = mergeSnapshots(base, changed);
    expect(merged.cards).toBe(changed.cards);
    expect(merged.placements).toBe(base.placements);
    expect(merged.edges).toBe(base.edges);
  });

  it("passes the first snapshot through", () => {
    const first = snapshot([card("a")]);
    expect(mergeSnapshots(undefined, first)).toBe(first);
  });
});

describe("reuseReferences", () => {
  it("reuses the whole object and each unchanged array", () => {
    const targets = ["b"];
    const previous = { a: targets };
    const next = { a: ["b"] };

    const merged = reuseReferences(previous, next);
    expect(merged).toBe(previous);
    expect(merged.a).toBe(targets);
  });

  it("keeps unchanged cards' arrays and replaces changed ones", () => {
    const first = ["b"];
    const previous = { a: first, b: ["a"] };
    const merged = reuseReferences(previous, { a: ["b"], b: ["c"] });

    expect(merged).not.toBe(previous);
    expect(merged.a).toBe(first);
    expect(merged.b).toEqual(["c"]);
  });

  it("drops removed cards and returns a new object", () => {
    const previous = { a: ["b"], gone: ["a"] };
    const merged = reuseReferences(previous, { a: ["b"] });

    expect(merged).not.toBe(previous);
    expect(Object.keys(merged)).toEqual(["a"]);
    expect(merged.a).toBe(previous.a);
  });
});
