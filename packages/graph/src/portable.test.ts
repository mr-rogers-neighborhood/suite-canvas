import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { exportPortable } from "./portable.js";

function addNode(parent: LoroMap, name: string, attrs: Record<string, unknown> = {}): LoroMap {
  const children = parent.ensureMergeableList("children");
  const node = children.insertContainer(children.length, new LoroMap());
  node.set("nodeName", name);
  const attributes = node.ensureMergeableMap("attributes");
  for (const [key, value] of Object.entries(attrs)) attributes.set(key, value);
  return node;
}

function addText(parent: LoroMap, text: string): void {
  const children = parent.ensureMergeableList("children");
  const value = children.insertContainer(children.length, new LoroText());
  value.insert(0, text);
}

function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, "Research");
  const status = workspace.addField("note", {
    name: "Status",
    kind: "select",
    options: ["Backlog", "Doing"],
  });
  const done = workspace.addField("note", { name: "Done", kind: "checkbox" });
  const tag = workspace.createTag({ name: "reading" });

  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  workspace.createCard({ id: "c2" });
  addText(workspace.getTitle("c2"), "Card two");
  workspace.addCardTag("c1", tag.id);
  workspace.setProperty("c1", status.id, status.options[1]?.id ?? "");
  workspace.setProperty("c1", done.id, true);

  const body = workspace.getContent("c1");
  const heading = addNode(body, "heading", { level: 1 });
  addText(heading, "Heading text");
  const paragraph = addNode(body, "paragraph");
  addText(paragraph, "A paragraph");
  const list = addNode(body, "bulletList");
  const item = addNode(list, "listItem");
  const itemParagraph = addNode(item, "paragraph");
  addText(itemParagraph, "First item");
  addNode(body, "mention", { cardId: "c2" });
  addNode(body, "propertyBlock", { fieldId: status.id });
  workspace.doc.commit({ origin: "test" });

  return { workspace, status };
}

describe("portable export", () => {
  it("should project cards, properties and body JSON", () => {
    const { workspace, status } = fixture();
    const portable = exportPortable(workspace, "2026-10-22T00:00:00.000Z");

    expect(portable.boards.map((board) => board.name)).toEqual(["Research"]);
    expect(portable.cards).toHaveLength(2);
    const card = portable.cards.find((entry) => entry.id === "c1");
    expect(card?.properties.map((property) => property.name)).toEqual(["Status", "Done"]);
    expect(card?.properties[0]?.value).toBe(status.options[1]?.id);
    expect(card?.body.map((node) => node.type)).toContain("heading");
    expect(card?.body.some((node) => node.type === "mention")).toBe(true);
    expect(card?.body.some((node) => node.type === "propertyBlock")).toBe(true);
  });

  it("should keep a link image in both projections, as a URL and a label", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    workspace.createCard({ id: "link", boardId: board.id, position: { x: 0, y: 0 } });
    addText(workspace.getTitle("link"), "Wiring plan");
    const paragraph = addNode(workspace.getContent("link"), "paragraph");
    addText(paragraph, "Before the photo.");
    addNode(workspace.getContent("link"), "image", {
      src: "https://cdn.example.com/photos/relay-rack.png",
      alt: "Rack elevation",
    });
    workspace.doc.commit({ origin: "test" });

    const portable = exportPortable(workspace);
    const card = portable.cards.find((entry) => entry.id === "link");
    expect(card?.body.some((node) => node.type === "image")).toBe(true);
    expect(portable.markdown).toContain(
      "![Rack elevation](https://cdn.example.com/photos/relay-rack.png)",
    );
  });

  it("should write readable Markdown with boards, properties, links and inbox", () => {
    const { workspace } = fixture();
    const { markdown } = exportPortable(workspace);

    expect(markdown).toContain("# Research");
    expect(markdown).toContain("### Heading text");
    expect(markdown).toContain("| Status | Doing |");
    expect(markdown).toContain("| Done | ✓ |");
    expect(markdown).toContain("- First item");
    expect(markdown).toContain("[[Card two]]");
    expect(markdown).toContain("**Status:** Doing");
    expect(markdown).toContain("# Inbox");
  });
});
