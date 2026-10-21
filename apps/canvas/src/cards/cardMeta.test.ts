import type { Card, CardType, Tag } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { cardMeta } from "./cardMeta";

const type: CardType = {
  id: "project",
  name: "Project",
  glyph: "P",
  createdAt: 0,
  updatedAt: 0,
  fields: [
    {
      id: "status",
      name: "Status",
      kind: "select",
      required: false,
      order: 0,
      options: [
        { id: "active", label: "Active", order: 0 },
        { id: "done", label: "Done", order: 1 },
      ],
    },
    { id: "owner", name: "Owner", kind: "text", required: false, order: 1, options: [] },
    { id: "done", name: "Done", kind: "checkbox", required: false, order: 2, options: [] },
    { id: "labels", name: "Labels", kind: "multiSelect", required: false, order: 3, options: [] },
  ],
};

const card: Card = {
  id: "c1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["project"],
  primaryTypeId: "project",
  tags: ["t1", "missing"],
  properties: { status: "active", owner: "Ada", done: true, labels: [] },
};

const tags = new Map<string, Tag>([["t1", { id: "t1", name: "Research", createdAt: 0 }]]);

describe("cardMeta", () => {
  it("should project the first two non-empty scalar properties", () => {
    const meta = cardMeta(card, new Map([["project", type]]), tags);

    expect(meta.properties).toEqual([
      { fieldId: "status", label: "Status", value: "Active" },
      { fieldId: "owner", label: "Owner", value: "Ada" },
    ]);
  });

  it("should resolve tag names and drop unknown memberships", () => {
    const meta = cardMeta(card, new Map([["project", type]]), tags);
    expect(meta.tags).toEqual(["Research"]);
  });

  it("should fall back to tags when the type is missing", () => {
    const meta = cardMeta(card, new Map(), tags);
    expect(meta.properties).toEqual([]);
    expect(meta.tags).toEqual(["Research"]);
  });

  it("should return the shared empty meta when there is nothing to show", () => {
    const bare: Card = { ...card, tags: [], properties: {} };
    const first = cardMeta(bare, new Map([["project", type]]), tags);
    const second = cardMeta(bare, new Map([["project", type]]), tags);
    expect(first).toBe(second);
  });
});
