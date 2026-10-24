import { WorkspaceDocument } from "@suite/graph";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Schema } from "@tiptap/pm/model";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createNodeFromLoroObj, type LoroNode } from "loro-prosemirror";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropertyBlock } from "./PropertyBlock";

// The node view needs a live workspace; serialisation and the Loro tree do not.
vi.mock("./PropertyBlockChip", () => ({ PropertyBlockNodeView: () => null }));

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(cardId = "c1"): Editor {
  editor = new Editor({
    extensions: [StarterKit, PropertyBlock.configure({ cardId, openPanel: () => {} })],
    content: "",
  });
  return editor;
}

function fieldIds(doc: PMNode): unknown[] {
  const ids: unknown[] = [];
  doc.descendants((node) => {
    if (node.type.name === "propertyBlock") ids.push(node.attrs.fieldId);
    return true;
  });
  return ids;
}

/** The schema `loro-prosemirror` builds from the same node declarations. */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    propertyBlock: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { fieldId: {} },
      selectable: false,
      draggable: false,
    },
  },
});

function setupWorkspace() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureView();
  workspace.ensureDefaultTypes();
  const project = workspace.createType({ name: "Project", glyph: "P" });
  const owner = workspace.addField(project.id, { name: "Owner", kind: "text" });
  workspace.createCard({ id: "c1", typeId: project.id, boardId: board.id });
  return { workspace, owner };
}

describe("PropertyBlock node", () => {
  it("should store only the field id and parse it back from HTML", () => {
    const current = createEditor();
    current.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "propertyBlock", attrs: { fieldId: "owner" } }],
        },
      ],
    });

    const html = current.getHTML();
    expect(html).toContain('data-field-id="owner"');

    current.commands.setContent(html);
    expect(fieldIds(current.state.doc)).toEqual(["owner"]);
    // An inline atom: it sits inside the paragraph and holds no caret position.
    expect(current.state.doc.firstChild?.childCount).toBe(1);
    expect(current.state.doc.firstChild?.child(0).isAtom).toBe(true);
    expect(current.state.doc.firstChild?.child(0).isInline).toBe(true);
  });

  it("should survive a round-trip through the Loro body", () => {
    const { workspace, owner } = setupWorkspace();
    workspace.appendPropertyBlock("c1", owner.id);

    const rebuilt = createNodeFromLoroObj(
      schema,
      workspace.peekContent("c1") as unknown as LoroNode,
      new Map(),
    ) as PMNode;

    expect(fieldIds(rebuilt)).toEqual([owner.id]);
    // The block's paragraph plus the trailing typing paragraph.
    expect(rebuilt.childCount).toBe(2);
    expect(rebuilt.child(0).type.name).toBe("paragraph");
    expect(rebuilt.child(1).textContent).toBe("");
  });

  it("should read a missing field id without throwing", () => {
    const current = createEditor();
    current.commands.setContent('<p><span data-field-id="gone">Property</span></p>');

    expect(fieldIds(current.state.doc)).toEqual(["gone"]);
  });
});
