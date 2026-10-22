import { LoroDoc, type LoroList, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  arrowSources,
  incomingReferences,
  mentionContext,
  mentionTargets,
  outgoingPropertyLinks,
  outgoingReferences,
  propertySources,
  referenceCount,
  sameTargets,
} from "./references.js";
import type { Card, CardType, FieldDefinition, GraphEdge } from "./schema.js";

function node(parent: LoroList, name: string, attributes: Record<string, unknown> = {}): LoroMap {
  const map = parent.insertContainer(parent.length, new LoroMap());
  map.set("nodeName", name);
  const attrs = map.ensureMergeableMap("attributes");
  for (const [key, value] of Object.entries(attributes)) attrs.set(key, value);
  return map;
}

function kids(map: LoroMap): LoroList {
  return map.ensureMergeableList("children");
}

function mention(parent: LoroList, cardId: unknown): LoroMap {
  const map = node(parent, "mention");
  if (cardId !== undefined) map.ensureMergeableMap("attributes").set("cardId", cardId);
  return map;
}

function bodyDoc(): { doc: LoroDoc; root: LoroMap } {
  const doc = new LoroDoc();
  const root = doc.getMap("content");
  root.set("nodeName", "doc");
  return { doc, root };
}

describe("mentionTargets", () => {
  it("should find mentions nested through lists and marked text", () => {
    const { root } = bodyDoc();
    const list = node(kids(root), "bulletList");
    const item = node(kids(list), "listItem");
    const paragraph = node(kids(item), "paragraph");
    const inline = kids(paragraph);
    const text = inline.insertContainer(inline.length, new LoroText());
    text.insert(0, "see ");
    text.mark({ start: 0, end: 3 }, "bold", true);
    mention(inline, "card-1");
    mention(inline, "card-2");

    expect(mentionTargets(root)).toEqual(["card-1", "card-2"]);
  });

  it("should collapse duplicate targets to their first mention", () => {
    const { root } = bodyDoc();
    const paragraph = node(kids(root), "paragraph");
    mention(kids(paragraph), "card-1");
    mention(kids(paragraph), "card-2");
    mention(kids(paragraph), "card-1");

    expect(mentionTargets(root)).toEqual(["card-1", "card-2"]);
  });

  it("should read mentions from a title and a body in document order", () => {
    const title = bodyDoc();
    const body = bodyDoc();
    mention(kids(node(kids(title.root), "paragraph")), "from-title");
    mention(kids(node(kids(body.root), "paragraph")), "from-body");

    expect(mentionTargets([title.root, body.root])).toEqual(["from-title", "from-body"]);
  });

  it("should ignore malformed nodes instead of failing", () => {
    const { root } = bodyDoc();
    const paragraph = node(kids(root), "paragraph");
    const inline = kids(paragraph);
    mention(inline, undefined);
    mention(inline, 42);
    mention(inline, "   ");
    inline.insert(inline.length, "stray text");
    const unnamed = inline.insertContainer(inline.length, new LoroMap());
    unnamed.set("nodeName", 7);
    mention(kids(unnamed), "real");

    expect(mentionTargets(root)).toEqual(["real"]);
  });

  it("should return nothing for text and empty values", () => {
    const { doc, root } = bodyDoc();
    const text = doc.getText("plain");
    text.insert(0, "hello");

    expect(mentionTargets(text)).toEqual([]);
    expect(mentionTargets(root)).toEqual([]);
    expect(mentionTargets(null)).toEqual([]);
    expect(mentionTargets(undefined)).toEqual([]);
  });
});

describe("reference helpers", () => {
  const field = (overrides: Partial<FieldDefinition>): FieldDefinition => ({
    id: "f1",
    name: "Field",
    kind: "text",
    required: false,
    order: 0,
    options: [],
    ...overrides,
  });

  const card = (id: string, properties: Record<string, unknown> = {}): Card => ({
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [],
    deletedAt: null,
    typeIds: ["note"],
    primaryTypeId: "note",
    tags: [],
    properties: properties as Card["properties"],
  });

  const type = (fields: FieldDefinition[]): CardType => ({
    id: "t",
    name: "Thing",
    glyph: "\u25c7",
    createdAt: 0,
    updatedAt: 0,
    fields,
  });

  const edge = (id: string, source: string, target: string, label?: string): GraphEdge => ({
    id,
    boardId: "b1",
    source,
    target,
    kind: "references",
    path: "bezier",
    bidirectional: false,
    ...(label === undefined ? {} : { label }),
    createdAt: 0,
    updatedAt: 0,
  });

  const references = {
    a: ["b", "c"],
    b: ["b"],
    c: ["gone"],
  };

  it("should list incoming sources, including self-references", () => {
    expect(incomingReferences("b", references)).toEqual(["a", "b"]);
    expect(incomingReferences("gone", references)).toEqual(["c"]);
    expect(incomingReferences("nobody", references)).toEqual([]);
  });

  it("should list outgoing targets and keep dangling ids", () => {
    expect(outgoingReferences("a", references)).toEqual(["b", "c"]);
    expect(outgoingReferences("c", references)).toEqual(["gone"]);
    expect(outgoingReferences("nobody", references)).toEqual([]);
  });

  it("should name the fields that point at a card", () => {
    const cards = [
      card("one", { f1: "target" }),
      card("two", { f1: "elsewhere" }),
      card("three", { f1: "target", f2: 3, f3: ["target"] }),
      card("self", { f1: "self" }),
    ];
    const types = [type([field({ id: "f1", name: "Contradicts", kind: "card" })])];

    expect(propertySources("target", cards, types)).toEqual([
      { cardId: "one", fieldId: "f1", fieldName: "Contradicts" },
      { cardId: "three", fieldId: "f1", fieldName: "Contradicts" },
    ]);
    expect(propertySources("self", cards, types)).toEqual([
      { cardId: "self", fieldId: "f1", fieldName: "Contradicts" },
    ]);
    expect(propertySources("target", [card("four", { unknown: "target" })])).toEqual([
      { cardId: "four", fieldId: "unknown", fieldName: "unknown" },
    ]);
  });

  it("should return both arrow endpoints with their description", () => {
    const edges = [
      edge("e1", "target", "other", "causes"),
      edge("e2", "other", "target"),
      edge("e3", "a", "b"),
      edge("e4", "target", "target", "itself"),
    ];

    expect(arrowSources("target", edges)).toEqual([
      {
        edgeId: "e1",
        otherCardId: "other",
        boardId: "b1",
        direction: "out",
        description: "causes",
      },
      { edgeId: "e2", otherCardId: "other", boardId: "b1", direction: "in" },
      {
        edgeId: "e4",
        otherCardId: "target",
        boardId: "b1",
        direction: "out",
        description: "itself",
      },
    ]);
  });

  it("should count distinct related cards across every source", () => {
    const cards = [card("source", { f1: "target" })];
    const edges = [edge("e1", "target", "neighbour")];
    const types = [type([field({ id: "f1", kind: "card" })])];

    // source mentions target and points at it; neighbour draws an arrow.
    expect(
      referenceCount("target", {
        references: { source: ["target"], other: ["nobody"] },
        cards,
        edges,
        types,
      }),
    ).toBe(2);
    expect(referenceCount("target", { references: {}, cards: [], edges: [] })).toBe(0);
  });

  it("should compare target sets irrespective of order", () => {
    expect(sameTargets(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameTargets(["a", "b"], ["a"])).toBe(false);
    expect(sameTargets(["a", "a"], ["a", "b"])).toBe(false);
    expect(sameTargets([], [])).toBe(true);
  });
});

describe("mentionContext", () => {
  it("should return the text around the first matching mention", () => {
    const { root } = bodyDoc();
    const paragraphs = kids(root);
    const first = node(paragraphs, "paragraph");
    const firstKids = kids(first);
    const before = firstKids.insertContainer(0, new LoroText());
    before.insert(0, "Before text");
    mention(firstKids, "card-a");

    const second = node(paragraphs, "paragraph");
    const after = kids(second).insertContainer(0, new LoroText());
    after.insert(0, "After text");

    const context = mentionContext(root, "card-a");
    expect(context?.before).toBe("Before text");
    expect(context?.after).toBe("After text");
  });

  it("should return null when the card never mentions the target", () => {
    const { root } = bodyDoc();
    const first = node(kids(root), "paragraph");
    const only = kids(first).insertContainer(0, new LoroText());
    only.insert(0, "Nothing here");
    expect(mentionContext(root, "card-a")).toBeNull();
  });

  it("should separate text around a different mention", () => {
    const { root } = bodyDoc();
    const first = node(kids(root), "paragraph");
    const children = kids(first);
    const firstText = children.insertContainer(0, new LoroText());
    firstText.insert(0, "one");
    mention(children, "other");
    const secondText = children.insertContainer(children.length, new LoroText());
    secondText.insert(0, "two");
    mention(children, "card-a");

    expect(mentionContext(root, "card-a")?.before).toBe("one two");
  });
});

describe("outgoingPropertyLinks", () => {
  const types = [
    {
      id: "concept",
      name: "Concept",
      glyph: "\u25c6",
      fields: [
        { id: "partOf", name: "Part of", kind: "card" as const, order: 0, options: [] },
        { id: "status", name: "Status", kind: "text" as const, order: 1, options: [] },
      ],
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const card = (id: string, properties: Record<string, string>) => ({
    id,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    connectors: [],
    typeIds: ["concept"],
    primaryTypeId: "concept",
    tags: [],
    properties,
  });

  it("should name the field that carries each outgoing link", () => {
    const links = outgoingPropertyLinks("a", [card("a", { partOf: "b", status: "draft" })], types);
    expect(links).toEqual([{ cardId: "b", fieldId: "partOf", fieldName: "Part of" }]);
  });

  it("should ignore self references and empty values", () => {
    const links = outgoingPropertyLinks(
      "a",
      [card("a", { partOf: "a" }), card("b", { partOf: "" })],
      types,
    );
    expect(links).toEqual([]);
  });
});

describe("referenceCount", () => {
  const types = [
    {
      id: "concept",
      name: "Concept",
      glyph: "\u25c6",
      fields: [{ id: "partOf", name: "Part of", kind: "card" as const, order: 0, options: [] }],
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  const card = (id: string, properties: Record<string, string> = {}) => ({
    id,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    connectors: [],
    typeIds: ["concept"],
    primaryTypeId: "concept",
    tags: [],
    properties,
  });

  it("should count distinct related cards rather than occurrences", () => {
    const count = referenceCount("a", {
      references: { b: ["a"] },
      cards: [card("b", { partOf: "a" }), card("a")],
      edges: [],
      types,
    });
    // b mentions a and points at it through a field; it is still one card.
    expect(count).toBe(1);
  });

  it("should count both directions and ignore self links", () => {
    const count = referenceCount("a", {
      references: { a: ["a", "b"] },
      cards: [card("a", { partOf: "c" })],
      edges: [],
      types,
    });
    expect(count).toBe(2);
  });
});
