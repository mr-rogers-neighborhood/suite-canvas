import { getType, isContainer, LoroList, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  workspace.ensureDefaultTypes();
  const project = workspace.createType({ name: "Project", glyph: "P" });
  const owner = workspace.addField(project.id, { name: "Owner", kind: "text" });
  const due = workspace.addField(project.id, { name: "Due", kind: "date" });
  workspace.createCard({ id: "c1", typeId: project.id, boardId: board.id });
  return { workspace, owner, due };
}

function bodyChildren(workspace: WorkspaceDocument, cardId = "c1"): LoroList | null {
  const children = workspace.peekContent(cardId)?.get("children");
  return isContainer(children) && getType(children) === "List" ? (children as LoroList) : null;
}

/** Top-level node names of a body, in document order. */
function blockNames(workspace: WorkspaceDocument, cardId = "c1"): unknown[] {
  const children = bodyChildren(workspace, cardId);
  if (!children) return [];
  return children
    .toArray()
    .map((node) =>
      isContainer(node) && getType(node) === "Map" ? (node as LoroMap).get("nodeName") : null,
    );
}

describe("property blocks in a body", () => {
  it("should append a block and a trailing paragraph", () => {
    const { workspace, owner } = setup();

    expect(workspace.appendPropertyBlock("c1", owner.id)).toBe(true);

    expect(workspace.bodyPropertyBlocks("c1")).toEqual([owner.id]);
    const names = blockNames(workspace);
    expect(names).toEqual(["paragraph", "paragraph"]);
    // Nothing is written to the card's property value: the block is a view.
    expect(workspace.getCard("c1")?.properties).toEqual({});
  });

  it("should be idempotent per field", () => {
    const { workspace, owner } = setup();

    expect(workspace.appendPropertyBlock("c1", owner.id)).toBe(true);
    expect(workspace.appendPropertyBlock("c1", owner.id)).toBe(false);

    expect(workspace.bodyPropertyBlocks("c1")).toEqual([owner.id]);
    expect(blockNames(workspace)).toHaveLength(2);
  });

  it("should keep one block per field in document order", () => {
    const { workspace, owner, due } = setup();

    workspace.appendPropertyBlock("c1", owner.id);
    workspace.appendPropertyBlock("c1", due.id);

    expect(workspace.bodyPropertyBlocks("c1")).toEqual([owner.id, due.id]);
  });

  it("should refuse a missing card or field", () => {
    const { workspace } = setup();

    expect(workspace.appendPropertyBlock("nope", "owner")).toBe(false);
    expect(workspace.appendPropertyBlock("c1", "nope")).toBe(false);
    expect(workspace.bodyPropertyBlocks("c1")).toEqual([]);
    expect(workspace.bodyPropertyBlocks("nope")).toEqual([]);
  });

  it("should remove the block and the paragraph it leaves behind", () => {
    const { workspace, owner } = setup();
    workspace.appendPropertyBlock("c1", owner.id);

    expect(workspace.removePropertyBlock("c1", owner.id)).toBe(true);

    expect(workspace.bodyPropertyBlocks("c1")).toEqual([]);
    // The trailing typing paragraph survives; the block's own paragraph is gone.
    expect(blockNames(workspace)).toEqual(["paragraph"]);
  });

  it("should be idempotent on removal", () => {
    const { workspace, owner } = setup();
    workspace.appendPropertyBlock("c1", owner.id);

    expect(workspace.removePropertyBlock("c1", owner.id)).toBe(true);
    expect(workspace.removePropertyBlock("c1", owner.id)).toBe(false);
    expect(workspace.removePropertyBlock("nope", owner.id)).toBe(false);
  });

  it("should only remove the requested field's block", () => {
    const { workspace, owner, due } = setup();
    workspace.appendPropertyBlock("c1", owner.id);
    workspace.appendPropertyBlock("c1", due.id);

    workspace.removePropertyBlock("c1", owner.id);

    expect(workspace.bodyPropertyBlocks("c1")).toEqual([due.id]);
  });

  it("should not disturb a body an editor already wrote", () => {
    const { workspace, owner } = setup();
    // `loro-prosemirror` creates plain containers, not mergeable ones.
    const content = workspace.getContent("c1");
    content.set("nodeName", "doc");
    const blocks = content.getOrCreateContainer("children", new LoroList());
    const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    const attributes = paragraph.getOrCreateContainer("attributes", new LoroMap());
    attributes.set("textAlign", "left");
    const inline = paragraph.getOrCreateContainer("children", new LoroList());
    const text = inline.insertContainer(inline.length, new LoroText());
    text.insert(0, "Existing notes");
    workspace.doc.commit({ origin: "text:body" });

    workspace.appendPropertyBlock("c1", owner.id);

    expect(workspace.cardText("c1")).toContain("Existing notes");
    expect(blockNames(workspace)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(workspace.bodyPropertyBlocks("c1")).toEqual([owner.id]);
  });

  it("should keep the body valid when the only paragraph is the removed block", () => {
    const { workspace, owner } = setup();
    workspace.appendPropertyBlock("c1", owner.id);
    // Simulate a body whose trailing paragraph was deleted by a peer.
    const children = bodyChildren(workspace);
    if (children) {
      children.delete(1, 1);
      workspace.doc.commit({ origin: "text:body" });
    }

    workspace.removePropertyBlock("c1", owner.id);

    // One empty paragraph remains so the ProseMirror document stays valid.
    expect(blockNames(workspace)).toEqual(["paragraph"]);
  });
});
