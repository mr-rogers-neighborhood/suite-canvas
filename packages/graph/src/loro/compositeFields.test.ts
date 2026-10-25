import { describe, expect, it } from "vitest";
import { MAX_COMPOSITE_DEPTH, valueDepth } from "../composite.js";
import { projectWorkspace } from "../projection.js";
import type { FieldDefinition, PropertyValue } from "../schema.js";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

/**
 * Composing fields — `rating`, `group` and `list`
 * ([ADR-0057](../../../docs/decisions/0057-fields-can-compose.md)).
 *
 * The acceptance tests here are the storage ones: sub-values merge like
 * top-level values (§5) and one level of nesting is the rule (§4).
 */

function subField(field: FieldDefinition, index: number): string {
  const sub = field.subFields?.[index];
  if (!sub) throw new Error(`Field "${field.name}" has no sub-field ${index}`);
  return sub.id;
}

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  const type = workspace.createType({ name: "Recipe", glyph: "R" });
  const rating = workspace.addField(type.id, {
    name: "Score",
    kind: "rating",
    rating: { scale: 10, half: true },
  });
  const where = workspace.addField(type.id, {
    name: "Where I left off",
    kind: "group",
    subFields: [
      { name: "Chapter", kind: "text" },
      { name: "Page", kind: "number" },
      { name: "Read on", kind: "date" },
    ],
  });
  const ingredients = workspace.addField(type.id, {
    name: "Ingredients",
    kind: "list",
    itemKind: "group",
    subFields: [
      { name: "Item", kind: "text" },
      { name: "Amount", kind: "number" },
    ],
  });
  const steps = workspace.addField(type.id, {
    name: "Steps",
    kind: "list",
    subFields: [{ id: "item", name: "Step", kind: "text" }],
  });
  workspace.createCard({ id: "c1", typeId: type.id, boardId: board.id });
  return { workspace, type, rating, where, ingredients, steps };
}

function stored(workspace: WorkspaceDocument, fieldId: string): PropertyValue | undefined {
  return workspace.getCard("c1")?.properties[fieldId];
}

function sync(left: WorkspaceDocument, right: WorkspaceDocument): void {
  const fromLeft = left.exportSnapshot();
  const fromRight = right.exportSnapshot();
  right.importSnapshot(fromLeft);
  left.importSnapshot(fromRight);
}

describe("composing field definitions", () => {
  it("should keep a composite field's sub-schema", () => {
    const { workspace, type, where, ingredients, steps, rating } = setup();

    const definition = workspace.getType(type.id)?.fields.find((field) => field.id === where.id);
    expect(definition?.kind).toBe("group");
    expect(definition?.subFields?.map((sub) => sub.kind)).toEqual(["text", "number", "date"]);

    const listDefinition = workspace
      .getType(type.id)
      ?.fields.find((field) => field.id === ingredients.id);
    expect(listDefinition?.itemKind).toBe("group");
    expect(listDefinition?.subFields).toHaveLength(2);

    const scalarList = workspace.getType(type.id)?.fields.find((field) => field.id === steps.id);
    expect(scalarList?.itemKind).toBe("scalar");
    expect(scalarList?.subFields?.[0]?.id).toBe("item");

    const ratingDefinition = workspace
      .getType(type.id)
      ?.fields.find((field) => field.id === rating.id);
    expect(ratingDefinition?.rating).toEqual({ scale: 10, half: true });
  });

  it("should give a list added without a sub-schema a text item", () => {
    const { workspace, type } = setup();
    const bare = workspace.addField(type.id, { name: "Bare", kind: "list" });

    expect(bare.itemKind).toBe("scalar");
    expect(bare.subFields?.map((sub) => sub.kind)).toEqual(["text"]);
    workspace.setProperty("c1", bare.id, ["Mix"]);
    expect(stored(workspace, bare.id)).toEqual(["Mix"]);
  });

  it("should parse a field with no sub-fields, so existing documents stay valid", () => {
    const { workspace, type } = setup();
    const plain = workspace.addField(type.id, { name: "Plain", kind: "text" });

    expect(plain.subFields).toBeUndefined();
    expect(plain.itemKind).toBeUndefined();
  });
});

describe("rating", () => {
  it("should store a number and refuse a non-number", () => {
    const { workspace, rating } = setup();

    workspace.setProperty("c1", rating.id, 7.5);

    expect(stored(workspace, rating.id)).toBe(7.5);
    expect(() => workspace.setProperty("c1", rating.id, "seven")).toThrow(/expects a number/);
    expect(() => workspace.setProperty("c1", rating.id, 11)).toThrow(/between 0 and 10/);
  });

  it("should refuse a half step when the field has none", () => {
    const { workspace, type } = setup();
    const whole = workspace.addField(type.id, { name: "Whole", kind: "rating" });

    expect(() => workspace.setProperty("c1", whole.id, 3.5)).toThrow(/whole number/);
    workspace.setProperty("c1", whole.id, 3);
    expect(stored(workspace, whole.id)).toBe(3);
  });
});

describe("group", () => {
  it("should accept its declared sub-field ids and refuse an undeclared one", () => {
    const { workspace, where } = setup();
    const chapter = subField(where, 0);
    const page = subField(where, 1);

    workspace.setProperty("c1", where.id, { [chapter]: "One", [page]: 12 });

    expect(stored(workspace, where.id)).toEqual({ [chapter]: "One", [page]: 12 });
    expect(() => workspace.setProperty("c1", where.id, { nope: "x" })).toThrow(/not one of them/);
  });

  it("should refuse a nested value: a group holds scalars only", () => {
    const { workspace, where } = setup();
    const chapter = subField(where, 0);

    expect(() => workspace.setProperty("c1", where.id, { [chapter]: ["a", "b"] })).toThrow(
      /nests one level/,
    );
  });

  it("should accept a partial group, since required stays advisory", () => {
    const { workspace, where } = setup();
    const page = subField(where, 1);

    workspace.setProperty("c1", where.id, { [page]: 40 });

    expect(stored(workspace, where.id)).toEqual({ [page]: 40 });
  });

  it("should clear one sub-value without disturbing the others", () => {
    const { workspace, where } = setup();
    const chapter = subField(where, 0);
    const page = subField(where, 1);

    workspace.setProperty("c1", where.id, { [chapter]: "Two", [page]: 30 });
    workspace.setProperty("c1", where.id, { [chapter]: "Two" });

    expect(stored(workspace, where.id)).toEqual({ [chapter]: "Two" });
  });
});

describe("list", () => {
  it("should accept its item kind and refuse a deeper nesting", () => {
    const { workspace, ingredients } = setup();
    const item = subField(ingredients, 0);
    const amount = subField(ingredients, 1);

    workspace.setProperty("c1", ingredients.id, [
      { [item]: "Flour", [amount]: 200 },
      { [item]: "Salt", [amount]: 3 },
    ]);

    expect(stored(workspace, ingredients.id)).toEqual([
      { [item]: "Flour", [amount]: 200 },
      { [item]: "Salt", [amount]: 3 },
    ]);
    expect(() => workspace.setProperty("c1", ingredients.id, [{ [item]: ["nested"] }])).toThrow(
      /nests one level/,
    );
    expect(() => workspace.setProperty("c1", ingredients.id, ["Flour"])).toThrow(
      /each item to be a group/,
    );
  });

  it("should refuse an item that is not the declared scalar kind", () => {
    const { workspace, steps } = setup();

    workspace.setProperty("c1", steps.id, ["Mix", "Bake"]);

    expect(stored(workspace, steps.id)).toEqual(["Mix", "Bake"]);
    expect(() => workspace.setProperty("c1", steps.id, [{ item: "Mix" }])).toThrow(
      /nests one level/,
    );
    expect(() => workspace.setProperty("c1", steps.id, "Mix")).toThrow(/a list of items/);
  });

  it("should store at most one level of nesting", () => {
    const { workspace, ingredients, where, rating } = setup();
    const item = subField(ingredients, 0);
    const chapter = subField(where, 0);
    workspace.setProperty("c1", ingredients.id, [{ [item]: "Flour" }]);
    workspace.setProperty("c1", where.id, { [chapter]: "One" });
    workspace.setProperty("c1", rating.id, 4);

    expect(valueDepth(stored(workspace, ingredients.id))).toBe(2);
    expect(valueDepth(stored(workspace, where.id))).toBe(1);
    expect(valueDepth(stored(workspace, rating.id))).toBe(0);
    expect(valueDepth(stored(workspace, ingredients.id))).toBeLessThanOrEqual(MAX_COMPOSITE_DEPTH);
  });

  it("should keep the order the editor committed", () => {
    const { workspace, steps } = setup();

    workspace.setProperty("c1", steps.id, ["a", "b", "c"]);
    workspace.setProperty("c1", steps.id, ["c", "a", "b"]);
    workspace.setProperty("c1", steps.id, ["a", "c"]);

    expect(stored(workspace, steps.id)).toEqual(["a", "c"]);
  });
});

describe("concurrent composite writes", () => {
  it("should keep both appended list entries", () => {
    const { workspace: left, ingredients } = setup();
    const item = subField(ingredients, 0);
    const amount = subField(ingredients, 1);
    const flour = { [item]: "Flour", [amount]: 200 };
    left.setProperty("c1", ingredients.id, [flour]);

    const right = new WorkspaceDocument();
    right.importSnapshot(left.exportSnapshot());

    left.setProperty("c1", ingredients.id, [flour, { [item]: "Salt", [amount]: 3 }]);
    right.setProperty("c1", ingredients.id, [flour, { [item]: "Sugar", [amount]: 5 }]);

    sync(left, right);

    const merged = stored(left, ingredients.id);
    expect(merged).toEqual(stored(right, ingredients.id));
    expect(Array.isArray(merged)).toBe(true);
    const items = (merged as PropertyValue[]).map(
      (entry) => (entry as Record<string, PropertyValue>)[item],
    );
    expect(new Set(items)).toEqual(new Set(["Flour", "Salt", "Sugar"]));
    expect(items[0]).toBe("Flour");
  });

  it("should keep edits to different sub-values of one group", () => {
    const { workspace: left, where } = setup();
    const chapter = subField(where, 0);
    const page = subField(where, 1);
    const readOn = subField(where, 2);
    left.setProperty("c1", where.id, { [chapter]: "One" });

    const right = new WorkspaceDocument();
    right.importSnapshot(left.exportSnapshot());

    left.setProperty("c1", where.id, { [chapter]: "One", [page]: 10 });
    right.setProperty("c1", where.id, { [chapter]: "One", [readOn]: "2026-01-02" });

    sync(left, right);

    const expected = { [chapter]: "One", [page]: 10, [readOn]: "2026-01-02" };
    expect(stored(left, where.id)).toEqual(expected);
    expect(stored(right, where.id)).toEqual(expected);
  });
});

describe("durability", () => {
  it("should survive a snapshot round-trip", () => {
    const { workspace, type, ingredients, where, steps, rating } = setup();
    const item = subField(ingredients, 0);
    const amount = subField(ingredients, 1);
    const chapter = subField(where, 0);
    workspace.setProperty("c1", ingredients.id, [{ [item]: "Flour", [amount]: 200 }]);
    workspace.setProperty("c1", where.id, { [chapter]: "Three" });
    workspace.setProperty("c1", steps.id, ["Mix"]);
    workspace.setProperty("c1", rating.id, 8);

    const restored = new WorkspaceDocument();
    restored.importSnapshot(workspace.exportSnapshot());

    const card = restored.getCard("c1");
    expect(card?.properties[ingredients.id]).toEqual([{ [item]: "Flour", [amount]: 200 }]);
    expect(card?.properties[where.id]).toEqual({ [chapter]: "Three" });
    expect(card?.properties[steps.id]).toEqual(["Mix"]);
    expect(card?.properties[rating.id]).toBe(8);
    const restoredField = restored
      .getType(type.id)
      ?.fields.find((field) => field.id === ingredients.id);
    expect(restoredField?.subFields?.map((sub) => sub.name)).toEqual(["Item", "Amount"]);
  });

  it("should travel with a share projection", () => {
    const { workspace, ingredients, where, steps } = setup();
    const item = subField(ingredients, 0);
    const chapter = subField(where, 0);
    workspace.setProperty("c1", ingredients.id, [{ [item]: "Flour" }]);
    workspace.setProperty("c1", where.id, { [chapter]: "Five" });
    workspace.setProperty("c1", steps.id, ["Mix"]);

    const share = projectWorkspace(workspace, { scope: "card", cardId: "c1" }).workspace;
    const card = share.getCard("c1");

    expect(card?.properties[ingredients.id]).toEqual([{ [item]: "Flour" }]);
    expect(card?.properties[where.id]).toEqual({ [chapter]: "Five" });
    expect(card?.properties[steps.id]).toEqual(["Mix"]);
  });

  it("should leave the value dormant when the field is removed", () => {
    const { workspace, type, where } = setup();
    const chapter = subField(where, 0);
    workspace.setProperty("c1", where.id, { [chapter]: "Four" });

    workspace.removeField(type.id, where.id);

    // The field is gone, so no surface shows it — but the value is still there,
    // still readable as a group, and revives when a field uses the same id.
    expect(workspace.getType(type.id)?.fields.some((field) => field.id === where.id)).toBe(false);
    expect(stored(workspace, where.id)).toEqual({ [chapter]: "Four" });
  });
});
