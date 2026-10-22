import { type Card, type CardType, type GraphEdge, referenceCount } from "@suite/graph";
import { describe, expect, it, vi } from "vitest";
import { referenceCounts } from "./useReferenceCounts";

// The memo is pure; keep the store (and its websocket provider) out of the test.
vi.mock("../store/workspaceStore", () => ({
  useWorkspaceStore: () => {
    throw new Error("referenceCounts does not read the store");
  },
}));

const type: CardType = {
  id: "project",
  name: "Project",
  glyph: "P",
  createdAt: 0,
  updatedAt: 0,
  fields: [
    { id: "related", name: "Related", kind: "card", required: false, order: 0, options: [] },
    { id: "blocks", name: "Blocks", kind: "card", required: false, order: 1, options: [] },
  ],
};

const makeCard = (id: string, properties: Card["properties"] = {}): Card => ({
  id,
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["project"],
  primaryTypeId: "project",
  tags: [],
  properties,
});

const edge = (id: string, source: string, target: string): GraphEdge => ({
  id,
  boardId: "board-1",
  source,
  target,
  kind: "relates-to",
  path: "bezier",
  bidirectional: false,
  createdAt: 0,
  updatedAt: 0,
});

const input = {
  references: {
    n2: ["n1"],
    n3: ["n1", "n4"],
  },
  cards: [
    makeCard("n1"),
    makeCard("n2"),
    makeCard("n3", { related: "n1" }),
    makeCard("n4", { related: "n1", blocks: "n1" }),
  ],
  // A self-loop counts once, like `arrowSources` yields one row for it.
  edges: [edge("e1", "n1", "n4"), edge("e2", "n2", "n2"), edge("e3", "n3", "n4")],
  types: [type],
};

describe("referenceCounts", () => {
  it("matches referenceCount for every card", () => {
    const lookup = referenceCounts(input);

    for (const card of input.cards) {
      expect(lookup(card.id)).toBe(referenceCount(card.id, input));
    }
  });

  it("counts the distinct cards a card is linked to, from either end", () => {
    const lookup = referenceCounts(input);

    // n1 is mentioned by n2 and n3, named by n3's and n4's card fields, and
    // drawn to: three partners, however many links there are between them.
    expect(lookup("n1")).toBe(3);
    // n2 links to n1 and its self-loop is not a partner.
    expect(lookup("n2")).toBe(1);
    // n3 mentions n1, names n1 and is drawn to n4.
    expect(lookup("n3")).toBe(2);
    // n4 names n1 and is drawn to by n1 and n3.
    expect(lookup("n4")).toBe(2);
  });

  it("returns zero for a card nothing points at", () => {
    expect(referenceCounts(input)("nobody")).toBe(0);
  });

  it("keeps the same lookup while the inputs keep their identity", () => {
    const first = referenceCounts(input);
    const second = referenceCounts(input);

    expect(second).toBe(first);
  });

  it("rebuilds when a section changes and keeps the others intact", () => {
    const first = referenceCounts(input);
    const next = { ...input, references: { ...input.references, n5: ["n1"] } };
    const second = referenceCounts(next);

    expect(second).not.toBe(first);
    expect(first("n1")).toBe(3);
    expect(second("n1")).toBe(4);
    expect(second("n5")).toBe(1);

    // Only one section moved, so the next call with `next`'s exact objects reuses it.
    expect(referenceCounts(next)).toBe(second);
  });

  it("rebuilds when the cards section is replaced, even if the contents match", () => {
    const first = referenceCounts(input);
    // `mergeSnapshots` keeps identities; a new array is a real snapshot change.
    const same = { ...input, cards: [...input.cards] };

    expect(referenceCounts(same)).not.toBe(first);
  });
});
