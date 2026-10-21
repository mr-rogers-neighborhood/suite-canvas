import type { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function sync(a: LoroDoc, b: LoroDoc): void {
  const fromA = a.export({ mode: "update" });
  const fromB = b.export({ mode: "update" });
  b.import(fromA);
  a.import(fromB);
}

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  workspace.ensureDefaultTypes();
  const project = workspace.createType({ name: "Project", glyph: "P" });
  workspace.createCard({ id: "c1", typeId: project.id, boardId: board.id });
  return { workspace, board, project };
}

describe("types", () => {
  it("should seed the starter types once", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const first = workspace
      .listTypes()
      .map((type) => type.id)
      .sort();
    workspace.ensureDefaultTypes();

    expect(first).toEqual(["concept", "note", "source"]);
    expect(
      workspace
        .listTypes()
        .map((type) => type.id)
        .sort(),
    ).toEqual(first);
  });

  it("should update name, glyph and colour field-granularly", () => {
    const { workspace, project } = setup();
    workspace.updateType(project.id, { name: "Initiative", glyph: "*", color: "#ff0000" });

    expect(workspace.getType(project.id)).toMatchObject({
      name: "Initiative",
      glyph: "*",
      color: "#ff0000",
    });
  });

  it("should refuse to delete the note type", () => {
    const { workspace } = setup();
    expect(() => workspace.deleteType("note")).toThrow();
  });

  it("should reassign cards when a type is deleted", () => {
    const { workspace, project, board } = setup();
    const other = workspace.createCard({ id: "c2", typeId: project.id, boardId: board.id });
    workspace.addCardType(other.id, "concept");

    const reassigned = workspace.deleteType(project.id, { reassignTo: "concept" });

    expect(reassigned).toBe(2);
    expect(workspace.getType(project.id)).toBeUndefined();
    expect(workspace.getCard("c1")?.typeIds).toEqual(["concept"]);
    expect(workspace.getCard("c1")?.primaryTypeId).toBe("concept");
    expect(workspace.getCard(other.id)?.typeIds).toEqual(expect.arrayContaining(["concept"]));
  });

  it("should tolerate a card that points at a missing type", () => {
    const { workspace, project } = setup();
    workspace.doc.getMap("types").delete(project.id);
    workspace.doc.commit({ origin: "test" });

    expect(workspace.getCard("c1")?.primaryTypeId).toBe(project.id);
    expect(workspace.getCard("c1")?.typeIds).toEqual([project.id]);
  });
});

describe("fields", () => {
  it("should add fields in order and move one field", () => {
    const { workspace, project } = setup();
    const first = workspace.addField(project.id, { name: "Status", kind: "text" });
    const second = workspace.addField(project.id, { name: "Due", kind: "date" });

    expect(workspace.getType(project.id)?.fields.map((field) => field.name)).toEqual([
      "Status",
      "Due",
    ]);

    workspace.moveField(project.id, second.id, 0);
    expect(workspace.getType(project.id)?.fields.map((field) => field.name)).toEqual([
      "Due",
      "Status",
    ]);
    expect(workspace.getType(project.id)?.fields[1]?.id).toBe(first.id);
  });

  it("should create select options with stable ids", () => {
    const { workspace, project } = setup();
    const field = workspace.addField(project.id, {
      name: "Stage",
      kind: "select",
      options: ["Backlog", "Doing"],
    });

    expect(field.options.map((option) => option.label)).toEqual(["Backlog", "Doing"]);
    const extra = workspace.addSelectOption(project.id, field.id, { label: "Done" });
    workspace.updateSelectOption(project.id, field.id, extra.id, { label: "Shipped" });

    const options = workspace.getType(project.id)?.fields[0]?.options ?? [];
    expect(options.map((option) => option.label)).toEqual(["Backlog", "Doing", "Shipped"]);
    expect(options[2]?.id).toBe(extra.id);
  });

  it("should keep property values dormant when a field is removed", () => {
    const { workspace, project } = setup();
    const field = workspace.addField(project.id, { name: "Status", kind: "text" });
    workspace.setProperty("c1", field.id, "active");

    workspace.removeField(project.id, field.id);

    const card = workspace.getCard("c1");
    expect(card?.properties[field.id]).toBe("active");
    expect(card && workspace.viewCardFields(card)).toEqual([]);
  });

  it("should keep values dormant across a type switch", () => {
    const { workspace, project } = setup();
    const field = workspace.addField(project.id, { name: "Status", kind: "text" });
    workspace.setProperty("c1", field.id, "active");

    workspace.setCardTypes("c1", ["concept"]);
    expect(workspace.getCard("c1")?.properties[field.id]).toBe("active");

    workspace.setCardTypes("c1", [project.id]);
    expect(workspace.getCard("c1")?.properties[field.id]).toBe("active");
  });
});

describe("properties", () => {
  it("should validate values against the field kind", () => {
    const { workspace, project } = setup();
    const number = workspace.addField(project.id, { name: "Estimate", kind: "number" });
    const checkbox = workspace.addField(project.id, { name: "Done", kind: "checkbox" });
    const select = workspace.addField(project.id, {
      name: "Stage",
      kind: "select",
      options: ["Backlog", "Doing"],
    });

    expect(() => workspace.setProperty("c1", number.id, "many")).toThrow();
    expect(() => workspace.setProperty("c1", checkbox.id, 1)).toThrow();
    expect(() => workspace.setProperty("c1", select.id, "missing")).toThrow();
    expect(() => workspace.setProperty("c1", "unknown-field", "x")).toThrow();

    workspace.setProperty("c1", number.id, 3);
    workspace.setProperty("c1", checkbox.id, true);
    expect(workspace.getCard("c1")?.properties).toMatchObject({
      [number.id]: 3,
      [checkbox.id]: true,
    });
  });

  it("should store multi-select as a merge-safe option set", () => {
    const { workspace, project } = setup();
    const field = workspace.addField(project.id, {
      name: "Labels",
      kind: "multiSelect",
      options: ["one", "two", "three"],
    });
    const [one, two, three] = field.options;

    workspace.setProperty("c1", field.id, [one?.id ?? "", three?.id ?? ""]);
    expect(workspace.getCard("c1")?.properties[field.id]).toEqual([one?.id, three?.id].sort());

    workspace.setProperty("c1", field.id, [two?.id ?? ""]);
    expect(workspace.getCard("c1")?.properties[field.id]).toEqual([two?.id]);
  });

  it("should clear a property on request", () => {
    const { workspace, project } = setup();
    const field = workspace.addField(project.id, { name: "Status", kind: "text" });
    workspace.setProperty("c1", field.id, "active");
    workspace.clearProperty("c1", field.id);
    expect(workspace.getCard("c1")?.properties[field.id]).toBeUndefined();
  });
});

describe("tags", () => {
  it("should create tags case-insensitively once", () => {
    const { workspace } = setup();
    const tag = workspace.createTag({ name: "Research" });
    expect(() => workspace.createTag({ name: "research" })).toThrow();
    expect(workspace.ensureTag("RESEARCH").id).toBe(tag.id);
    expect(workspace.listTags()).toHaveLength(1);
  });

  it("should rename a tag without touching cards", () => {
    const { workspace } = setup();
    const tag = workspace.createTag({ name: "Research" });
    workspace.addCardTag("c1", tag.id);

    workspace.renameTag(tag.id, "Reading");

    expect(workspace.getTag(tag.id)?.name).toBe("Reading");
    expect(workspace.getCard("c1")?.tags).toEqual([tag.id]);
  });

  it("should leave membership dormant when a tag is deleted", () => {
    const { workspace } = setup();
    const tag = workspace.createTag({ name: "Research" });
    workspace.addCardTag("c1", tag.id);
    workspace.deleteTag(tag.id);

    expect(workspace.getCard("c1")?.tags).toEqual([tag.id]);
    expect(workspace.listCardsWithTag(tag.id)).toEqual([]);
  });
});

describe("queries", () => {
  it("should list alive cards by type and tag", () => {
    const { workspace, project, board } = setup();
    const tag = workspace.createTag({ name: "Research" });
    workspace.addCardTag("c1", tag.id);
    const trashed = workspace.createCard({ id: "c2", typeId: project.id, boardId: board.id });
    workspace.trashCard(trashed.id);

    expect(workspace.listCardsOfType(project.id).map((card) => card.id)).toEqual(["c1"]);
    expect(workspace.listCardsWithTag(tag.id).map((card) => card.id)).toEqual(["c1"]);
  });
});

describe("convergence", () => {
  it("should merge concurrent edits to different fields and types", () => {
    const a = new WorkspaceDocument();
    const b = new WorkspaceDocument();
    a.ensureDefaultTypes();
    b.ensureDefaultTypes();
    const project = a.createType({ id: "project", name: "Project" });
    const first = a.addField(project.id, { name: "Status", kind: "text" });
    const second = a.addField(project.id, { name: "Owner", kind: "text" });
    a.createCard({ id: "c1", typeId: project.id });
    sync(a.doc, b.doc);

    a.setProperty("c1", first.id, "active");
    b.setProperty("c1", second.id, "ada");
    b.addCardType("c1", "concept");
    sync(a.doc, b.doc);

    for (const workspace of [a, b]) {
      const card = workspace.getCard("c1");
      expect(card?.properties[first.id]).toBe("active");
      expect(card?.properties[second.id]).toBe("ada");
      expect(card?.typeIds).toEqual(expect.arrayContaining([project.id, "concept"]));
    }
  });

  it("should merge concurrent tag assignments", () => {
    const a = new WorkspaceDocument();
    const b = new WorkspaceDocument();
    a.createCard({ id: "c1" });
    const left = a.createTag({ name: "Left" });
    sync(a.doc, b.doc);
    const right = b.createTag({ name: "Right" });
    sync(a.doc, b.doc);

    a.addCardTag("c1", left.id);
    b.addCardTag("c1", right.id);
    sync(a.doc, b.doc);

    expect(a.getCard("c1")?.tags).toEqual([left.id, right.id].sort());
  });
});
