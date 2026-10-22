import type { Card, CardFieldView } from "@suite/graph";
import { describe, expect, it, vi } from "vitest";

const owner: CardFieldView = {
  typeId: "note",
  field: { id: "owner", name: "Owner", kind: "text", required: false, order: 0, options: [] },
};
const stage: CardFieldView = {
  typeId: "note",
  field: { id: "stage", name: "Stage", kind: "text", required: false, order: 1, options: [] },
};

const host: Card = {
  id: "c1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["note"],
  primaryTypeId: "note",
  tags: [],
  properties: {},
};

const other: Card = { ...host, id: "c2" };

const workspace = {
  getCard: (id: string) => (id === host.id ? host : undefined),
  viewCardFields: () => [owner, stage],
  displayTitle: (id: string) => (id === other.id ? "Beta" : "Alpha"),
};

vi.mock("../store/useCanvasStore", () => ({
  useCanvasStore: { getState: () => ({ workspace }) },
}));
vi.mock("../store/workspaceSnapshotStore", () => ({
  workspaceSnapshotStore: () => ({
    getSnapshot: () => ({
      types: [
        { id: "note", name: "Note", glyph: "\u25a1", createdAt: 0, updatedAt: 0, fields: [] },
      ],
      cards: [host, other],
    }),
  }),
}));

const { rankItems } = await import("./SuggestionList");

describe("rankItems", () => {
  it("should list this card's fields above every card", () => {
    const items = rankItems("", host.id);

    // The card being edited is never offered as a mention of itself.
    expect(items.map((item) => item.title)).toEqual(["Owner", "Stage", "Beta"]);
    expect(items.map((item) => item.kind)).toEqual(["field", "field", "card"]);
    expect(items[0]?.fieldId).toBe("owner");
  });

  it("should filter fields and cards by the same query", () => {
    expect(rankItems("own", host.id).map((item) => item.title)).toEqual(["Owner"]);
    // "bet" names only Beta, so its fields come along for the ride.
    expect(rankItems("bet", host.id).map((item) => item.title)).toEqual([
      "Beta",
      "Beta \u00b7 Owner",
      "Beta \u00b7 Stage",
    ]);
  });

  it("should leave fields out when the editor has no owner card", () => {
    expect(rankItems("").map((item) => item.kind)).toEqual(["card", "card"]);
  });

  it("should open a card's fields once the query names only that card", () => {
    const items = rankItems("beta", host.id);

    // The card stays first, so Enter still inserts it; its fields follow.
    expect(items[0]).toEqual({ id: other.id, title: "Beta", glyph: "\u25a1", kind: "card" });
    expect(items.map((item) => item.kind)).toEqual(["card", "reference", "reference"]);
    expect(items[1]).toMatchObject({
      cardId: other.id,
      fieldId: "owner",
      title: "Beta \u00b7 Owner",
    });
  });

  it("should narrow the drilled-in fields by the typed dot", () => {
    const items = rankItems("Beta.sta", host.id);

    expect(items.map((item) => item.kind)).toEqual(["reference"]);
    expect(items[0]).toMatchObject({ cardId: other.id, fieldId: "stage" });
  });

  it("should not drill into the card being edited", () => {
    expect(rankItems("alpha", host.id).map((item) => item.kind)).not.toContain("reference");
  });

  it("should offer a dot query as a reference to another card's field", () => {
    const items = rankItems("Beta.own", host.id);
    const reference = items.find((item) => item.kind === "reference");

    expect(reference).toMatchObject({
      cardId: other.id,
      fieldId: "owner",
      title: "Beta \u00b7 Owner",
    });
    expect(items.map((item) => item.kind)).toEqual(["reference"]);
  });

  it("should not offer this card's own fields as references", () => {
    expect(rankItems("Alpha.own", host.id).some((item) => item.kind === "reference")).toBe(false);
  });

  it("should filter reference rows by the text after the dot", () => {
    expect(rankItems("Beta.sta", host.id).map((item) => item.kind)).toEqual(["reference"]);
  });
});
