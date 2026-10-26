import type { Card, GraphEdge, Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { explainContext } from "./explainContext";

/** A card with the fields the gatherer reads; the rest is noise for this shape. */
function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [],
    typeIds: ["type-note"],
    primaryTypeId: "type-note",
    tags: [],
    properties: {},
    ...overrides,
  } as Card;
}

function section(id: string, title: string): Section {
  return { id, title, createdAt: 0, updatedAt: 0 } as unknown as Section;
}

function edge(id: string, source: string, target: string, overrides = {}): GraphEdge {
  return {
    id,
    boardId: "board-1",
    source,
    target,
    kind: "relates-to",
    path: "bezier",
    bidirectional: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as GraphEdge;
}

const typeNames = new Map([["type-note", "note"]]);

function gather(selectedIds: string[], input: Partial<Parameters<typeof explainContext>[0]> = {}) {
  return explainContext({
    selectedIds,
    cards: [],
    sections: [],
    edges: [],
    titles: new Map(),
    typeNames,
    ...input,
  });
}

describe("explainContext", () => {
  it("gathers nothing when nothing is selected", () => {
    const context = gather([], { cards: [card("a")], edges: [edge("e", "a", "b")] });

    expect(context.entities).toEqual([]);
    expect(context.links).toEqual([]);
    expect(context.partial).toBe(false);
  });

  it("gathers the selected cards with their types and fields", () => {
    const context = gather(["a"], {
      cards: [
        card("a", { properties: { Status: "Draft", Score: 3 } }),
        card("b", { properties: {} }),
      ],
      titles: new Map([["a", "Anchor"]]),
    });

    // Only what was selected: `b` is on the board and not in the question.
    expect(context.entities).toHaveLength(1);
    expect(context.entities[0]).toMatchObject({ id: "a", title: "Anchor", kind: "note" });
    expect(context.entities[0]?.fields).toEqual([
      { label: "Status", value: "Draft" },
      { label: "Score", value: "3" },
    ]);
  });

  it("names an untitled card rather than leaving a blank row", () => {
    const context = gather(["a"], { cards: [card("a")], titles: new Map([["a", "   "]]) });

    expect(context.entities[0]?.title).toBe("Untitled");
  });

  it("falls back to the primary type id when the type is unknown", () => {
    const unknown = gather(["a"], {
      cards: [card("a", { primaryTypeId: "type-missing" })],
      typeNames: new Map(),
    });

    expect(unknown.entities[0]?.kind).toBe("note");
  });

  it("gathers sections as entities with no fields", () => {
    const context = gather(["s"], { sections: [section("s", "Writing")] });

    expect(context.entities[0]).toMatchObject({ id: "s", title: "Writing", kind: "section" });
    expect(context.entities[0]?.fields).toEqual([]);
  });

  it("links only the pairs whose ends are both in the selection", () => {
    const context = gather(["a", "b"], {
      cards: [card("a"), card("b"), card("c")],
      titles: new Map([
        ["a", "Anchor"],
        ["b", "Target"],
        ["c", "Outside"],
      ]),
      edges: [
        edge("in", "a", "b"),
        edge("out", "a", "c"),
        edge("into", "c", "b"),
        // A self-link is a legitimate edge (ADR-0061) and belongs in the context.
        edge("self", "a", "a"),
      ],
    });

    expect(context.links.map((link) => link.id)).toEqual(["in", "self"]);
    expect(context.links[0]).toMatchObject({ from: "Anchor", to: "Target", kind: "relates-to" });
  });

  it("prefers a link's label over its kind, because that is what the reader named it", () => {
    const context = gather(["a", "b"], {
      cards: [card("a"), card("b")],
      edges: [edge("e", "a", "b", { label: "depends on" })],
    });

    expect(context.links[0]?.kind).toBe("depends on");
  });

  it("ignores trashed cards but says the selection was partly unexplainable", () => {
    const context = gather(["a", "gone"], {
      cards: [card("a"), card("gone", { deletedAt: 1 })],
      titles: new Map([["a", "Anchor"]]),
    });

    expect(context.entities.map((entity) => entity.id)).toEqual(["a"]);
    expect(context.partial).toBe(true);
  });

  it("renders compound property values instead of [object Object]", () => {
    const context = gather(["a"], {
      // `None` stands for a value the schema allows but the reader never sees; the
      // gatherer must not print `undefined` where a word belongs.
      cards: [
        card("a", {
          properties: { List: ["x", "y"], Meta: { k: 1 }, None: undefined as never },
        }),
      ],
    });

    expect(context.entities[0]?.fields).toEqual([
      { label: "List", value: "x, y" },
      { label: "Meta", value: '{"k":1}' },
      { label: "None", value: "—" },
    ]);
  });
});
