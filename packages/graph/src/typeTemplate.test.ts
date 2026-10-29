import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { expandTitleTemplate, hasTitleToken, titleTemplateValues } from "./templateTitle.js";

function addNode(parent: LoroMap, name: string): LoroMap {
  const children = parent.ensureMergeableList("children");
  const node = children.insertContainer(children.length, new LoroMap());
  node.set("nodeName", name);
  return node;
}

function addText(parent: LoroMap, text: string): void {
  const children = parent.ensureMergeableList("children");
  const value = children.insertContainer(children.length, new LoroText());
  value.insert(0, text);
}

function addParagraphs(body: LoroMap, ...paragraphs: string[]): void {
  for (const paragraph of paragraphs) addText(addNode(body, "paragraph"), paragraph);
}

/** A character type with one text field, and a template card that uses it. */
function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.createType({ id: "character", name: "Character" });
  const role = workspace.addField("character", { name: "Role", kind: "text" });

  const template = workspace.createCard({ typeId: "character", fromTemplate: false });
  addText(workspace.getTitle(template.id), "{{Role}} \u2014 a new character");
  addParagraphs(workspace.getContent(template.id), "Answer these questions:");
  workspace.setProperty(template.id, role.id, "Wanderer");
  workspace.updateType("character", { templateCardId: template.id });
  workspace.doc.commit({ origin: "test" });

  return { workspace, board, template, role };
}

describe("type templates", () => {
  it("should create a card that arrives already written", () => {
    const { workspace, board, template } = fixture();
    const card = workspace.createCard({ typeId: "character", boardId: board.id });

    expect(card.id).not.toBe(template.id);
    expect(workspace.cardText(card.id)).toContain("Answer these questions");
    expect(workspace.getCard(card.id)?.properties).toEqual(
      workspace.getCard(template.id)?.properties,
    );
  });

  it("should expand a plain title token once, from the new card's values", () => {
    const { workspace, board } = fixture();
    const card = workspace.createCard({ typeId: "character", boardId: board.id });
    expect(workspace.displayTitle(card.id)).toBe("Wanderer \u2014 a new character");
  });

  it("should leave the template's own title untouched", () => {
    const { workspace, template } = fixture();
    expect(workspace.displayTitle(template.id)).toBe("{{Role}} \u2014 a new character");
  });

  it("should fall back to a blank card when the template is gone", () => {
    const { workspace, board, template } = fixture();
    workspace.purgeCard(template.id);

    const card = workspace.createCard({ typeId: "character", boardId: board.id });
    expect(workspace.cardText(card.id)).toBe("");
    expect(workspace.getCard(card.id)?.properties).toEqual({});
  });

  it("should treat a trashed template as no template", () => {
    const { workspace, board, template } = fixture();
    workspace.trashCard(template.id);

    expect(workspace.templateCard("character")).toBeUndefined();
    const card = workspace.createCard({ typeId: "character", boardId: board.id });
    expect(workspace.cardText(card.id)).toBe("");
  });

  it("should keep an untemplated type exactly as it was", () => {
    const { workspace, board } = fixture();
    const note = workspace.createCard({ boardId: board.id });
    expect(workspace.cardText(note.id)).toBe("");
    expect(workspace.getCard(note.id)?.tags).toEqual([]);
  });

  it("should place the new card at the caller's position, not the template's", () => {
    const { workspace, board } = fixture();
    const card = workspace.createCard({
      typeId: "character",
      boardId: board.id,
      position: { x: 640, y: 480 },
    });
    expect(workspace.getPlacement(board.id, card.id)).toMatchObject({ x: 640, y: 480 });
  });

  it("should refuse a template id that is not a card", () => {
    const { workspace } = fixture();
    workspace.updateType("character", { templateCardId: "not-a-card" });
    expect(workspace.getType("character")?.templateCardId).toBeUndefined();
  });

  it("should clear a template with null", () => {
    const { workspace, board } = fixture();
    workspace.updateType("character", { templateCardId: null });
    expect(workspace.getType("character")?.templateCardId).toBeUndefined();

    const card = workspace.createCard({ typeId: "character", boardId: board.id });
    expect(workspace.cardText(card.id)).toBe("");
  });

  it("should survive a reopen with the template intact", () => {
    const { workspace, board, template } = fixture();
    const reopened = new WorkspaceDocument();
    reopened.importSnapshot(workspace.exportSnapshot());

    expect(reopened.getType("character")?.templateCardId).toBe(template.id);
    const card = reopened.createCard({ typeId: "character", boardId: board.id });
    expect(reopened.cardText(card.id)).toContain("Answer these questions");
  });
});

describe("title templates", () => {
  it("should read values by field name, case-insensitively", () => {
    const { workspace, role, template } = fixture();
    workspace.setProperty(template.id, role.id, "Ranger");

    const templateCard = workspace.getCard(template.id);
    if (!templateCard) throw new Error("fixture needs the template card");
    const values = titleTemplateValues(templateCard, workspace.listTypes());
    expect(values.get("role")).toBe("Ranger");
    expect(expandTitleTemplate("[{{ role }}] {{Missing}}", values)).toBe("[Ranger] {{Missing}}");
  });

  it("should replace several tokens and leave plain text alone", () => {
    const values = new Map([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(expandTitleTemplate("{{a}}/{{b}}", values)).toBe("1/2");
    expect(expandTitleTemplate("no tokens", values)).toBe("no tokens");
    expect(expandTitleTemplate("{{}}", values)).toBe("{{}}");
  });

  it("should detect whether a title has a token", () => {
    expect(hasTitleToken("{{Role}}")).toBe(true);
    expect(hasTitleToken("a title")).toBe(false);
    expect(hasTitleToken("{{ }}")).toBe(false);
  });
});

describe("a type's several templates", () => {
  /** Two template cards, ordered: a plain one first, a "wild" one second. */
  function ordered() {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    workspace.createType({ id: "recipe", name: "Recipe" });
    const first = workspace.createCard({ typeId: "recipe", fromTemplate: false });
    addParagraphs(workspace.getContent(first.id), "Sourdough method.");
    const second = workspace.createCard({ typeId: "recipe", fromTemplate: false });
    addParagraphs(workspace.getContent(second.id), "Focaccia method.");
    workspace.updateType("recipe", { templateCardIds: [first.id, second.id] });
    workspace.doc.commit({ origin: "test" });
    return { workspace, first, second };
  }

  it("should read the list back in the order it was written", () => {
    const { workspace, first, second } = ordered();
    expect(workspace.getType("recipe")?.templateCardIds).toEqual([first.id, second.id]);
    // The single field stays populated for anything still reading it, and names the first.
    expect(workspace.getType("recipe")?.templateCardId).toBe(first.id);
  });

  it("should copy the named template rather than the first", () => {
    const { workspace, first, second } = ordered();
    const board = workspace.ensureBoard();

    const plain = workspace.createCard({ typeId: "recipe", boardId: board.id });
    const other = workspace.createCard({
      typeId: "recipe",
      boardId: board.id,
      templateId: second.id,
    });

    expect(workspace.cardText(plain.id)).toContain("Sourdough");
    expect(workspace.cardText(other.id)).toContain("Focaccia");
    expect(other.id).not.toBe(first.id);
  });

  it("should copy nothing when the reader asks for a blank card", () => {
    const { workspace } = ordered();
    const card = workspace.createCard({ typeId: "recipe", fromTemplate: false });
    expect(workspace.cardText(card.id)).not.toContain("method");
  });

  it("should promote the second template by rewriting the order", () => {
    const { workspace, first, second } = ordered();
    workspace.updateType("recipe", { templateCardIds: [second.id, first.id] });
    expect(workspace.getType("recipe")?.templateCardId).toBe(second.id);

    const board = workspace.ensureBoard();
    const card = workspace.createCard({ typeId: "recipe", boardId: board.id });
    expect(workspace.cardText(card.id)).toContain("Focaccia");
  });

  it("should drop a template whose card is in the trash, and keep the rest", () => {
    const { workspace, first, second } = ordered();
    workspace.trashCard(first.id);
    expect(workspace.getType("recipe")?.templateCardIds).toEqual([first.id, second.id]);
    expect(workspace.templateCard("recipe")?.id).toBe(second.id);

    const board = workspace.ensureBoard();
    const card = workspace.createCard({ typeId: "recipe", boardId: board.id });
    expect(workspace.cardText(card.id)).toContain("Focaccia");
  });

  it("should keep the other templates when one is removed", () => {
    const { workspace, second } = ordered();
    workspace.updateType("recipe", { templateCardIds: [second.id] });
    expect(workspace.getType("recipe")?.templateCardIds).toEqual([second.id]);
    expect(workspace.getType("recipe")?.templateCardId).toBe(second.id);
    workspace.updateType("recipe", { templateCardIds: null });
    expect(workspace.getType("recipe")?.templateCardIds).toBeUndefined();
  });

  it("should read a document written before the list existed", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    workspace.createType({ id: "recipe", name: "Recipe" });
    const card = workspace.createCard({ typeId: "recipe", fromTemplate: false });
    addParagraphs(workspace.getContent(card.id), "The old single template.");
    // The pre-list shape, written straight into the record the way an old build did.
    const fields = workspace.doc.getMap("types").ensureMergeableMap("recipe");
    fields.set("templateCardId", card.id);
    workspace.doc.commit({ origin: "test" });

    expect(workspace.getType("recipe")?.templateCardIds).toEqual([card.id]);

    const board = workspace.ensureBoard();
    const copy = workspace.createCard({ typeId: "recipe", boardId: board.id });
    expect(workspace.cardText(copy.id)).toContain("The old single template.");
  });
});
