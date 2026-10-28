import { describe, expect, it } from "vitest";
import { edgeEndpoints, edgeTouches, isSelfLink, pairKey, sameEndpoint } from "./links.js";
import type { GraphEdge } from "./schema.js";

function edge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: "edge-1",
    boardId: "board-1",
    source: "a",
    target: "b",
    kind: "references",
    path: "bezier",
    bidirectional: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("edgeEndpoints", () => {
  it("reads a link without endpoint kinds as a card-to-card link", () => {
    expect(edgeEndpoints(edge())).toEqual({
      source: { kind: "card", id: "a" },
      target: { kind: "card", id: "b" },
    });
  });

  it("keeps the kinds it was given", () => {
    const ends = edgeEndpoints(edge({ sourceKind: "section", targetKind: "board" }));
    expect(ends.source).toEqual({ kind: "section", id: "a" });
    expect(ends.target).toEqual({ kind: "board", id: "b" });
  });

  it("lets one end be a container while the other stays a card", () => {
    const ends = edgeEndpoints(edge({ sourceKind: "board" }));
    expect(ends.source.kind).toBe("board");
    expect(ends.target.kind).toBe("card");
  });
});

describe("sameEndpoint and isSelfLink", () => {
  it("compares kind and id together", () => {
    expect(sameEndpoint({ kind: "card", id: "x" }, { kind: "card", id: "x" })).toBe(true);
    // A board and a card may share an id; they are not the same endpoint.
    expect(sameEndpoint({ kind: "card", id: "x" }, { kind: "board", id: "x" })).toBe(false);
  });

  it("refuses a link from a thing to itself only when the kind matches too", () => {
    expect(isSelfLink({ kind: "section", id: "s" }, { kind: "section", id: "s" })).toBe(true);
    expect(isSelfLink({ kind: "section", id: "s" }, { kind: "card", id: "s" })).toBe(false);
  });
});

describe("edgeTouches", () => {
  it("matches either end", () => {
    const link = edge({ sourceKind: "board", source: "b1" });
    expect(edgeTouches(link, { kind: "board", id: "b1" })).toBe(true);
    expect(edgeTouches(link, { kind: "card", id: "b" })).toBe(true);
    expect(edgeTouches(link, { kind: "section", id: "b" })).toBe(false);
  });
});

describe("pairKey", () => {
  it("ignores direction, so the same pair drawn backwards is one relationship", () => {
    const forward = edge({ id: "one" });
    const backward = edge({ id: "two", source: "b", target: "a" });
    expect(pairKey(forward)).toBe(pairKey(backward));
  });

  it("ignores the dots, because where a line attaches is not what it means", () => {
    const plain = edge({ id: "one" });
    const anchored = edge({ id: "one", sourceConnector: "c1", targetConnector: "c2" });
    expect(pairKey(plain)).toBe(pairKey(anchored));
  });

  it("separates endpoints that share an id but differ in kind", () => {
    const card = edge({ id: "one", source: "shared" });
    const board = edge({ id: "one", source: "shared", sourceKind: "board" });
    expect(pairKey(card)).not.toBe(pairKey(board));
  });

  it("separates the same pair on two boards", () => {
    const here = edge({ id: "one", boardId: "board-1" });
    const there = edge({ id: "two", boardId: "board-2" });
    expect(pairKey(here)).not.toBe(pairKey(there));
  });
});
