import { parseStep, type TourStepAttributes } from "@suite/graph";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Schema } from "@tiptap/pm/model";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createNodeFromLoroObj, type LoroNode } from "loro-prosemirror";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDocument } from "../../../../packages/graph/src/loro/WorkspaceDocument";
import { insertTourStep } from "../../../../packages/graph/src/tutorial";
import { TourStep } from "./TourStep";

// The node view reads the live workspace; serialisation and the Loro tree do not.
vi.mock("./TourStepView", () => ({ TourStepView: () => null }));

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(): Editor {
  editor = new Editor({
    extensions: [StarterKit, TourStep.configure({ cardId: "tour" })],
    content: "",
  });
  return editor;
}

function stepNodes(doc: PMNode): PMNode[] {
  const nodes: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === "tourStep") nodes.push(node);
    return true;
  });
  return nodes;
}

const authored: TourStepAttributes = {
  stepId: "step-1",
  targets: [{ kind: "card", id: "target" }],
  viewport: { x: 40, y: -20, zoom: 1.25 },
  caption: "Look at this card first",
  advance: "click",
};

describe("tour step block", () => {
  it("should round-trip its attributes through the document", () => {
    const current = createEditor();
    current.commands.insertContent({
      type: "tourStep",
      attrs: { ...authored, viewport: authored.viewport },
    });

    const [block] = stepNodes(current.state.doc);
    expect(block?.attrs).toEqual(authored);
    // The block stores the step's own shape, so the panel and the overlay read
    // it with the same parser the document does.
    expect(parseStep(block?.attrs)).toEqual({
      id: "step-1",
      targets: authored.targets,
      viewport: authored.viewport,
      caption: authored.caption,
      advance: "click",
    });
  });

  it("should survive HTML serialisation and parse back the same step", () => {
    const current = createEditor();
    current.commands.insertContent({ type: "tourStep", attrs: { ...authored } });

    const html = current.getHTML();
    expect(html).toContain("data-tour-step");

    const rehydrated = createEditor();
    rehydrated.commands.insertContent(html);
    const [block] = stepNodes(rehydrated.state.doc);
    expect(parseStep(block?.attrs)).toEqual(parseStep({ ...authored }));
  });

  it("should start empty and become a step once a target is set", () => {
    const current = createEditor();
    current.commands.insertContent({
      type: "tourStep",
      attrs: { stepId: "step-2", targets: [], advance: "next" },
    });

    const [before] = stepNodes(current.state.doc);
    expect(parseStep(before?.attrs)).toBeNull();

    current.commands.command(({ tr, state }) => {
      const node = state.doc.firstChild;
      if (!node) return false;
      tr.setNodeMarkup(0, undefined, { ...node.attrs, targets: [{ kind: "card", id: "a" }] });
      return true;
    });

    const [after] = stepNodes(current.state.doc);
    expect(parseStep(after?.attrs)?.targets).toEqual([{ kind: "card", id: "a" }]);
  });

  it("should read the same step from the Loro body an author wrote", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    workspace.ensureDefaultTypes();
    workspace.createCard({ id: "tour", typeId: "note", boardId: board.id });
    workspace.createCard({ id: "target", typeId: "note", boardId: board.id });
    insertTourStep(workspace, "tour", {
      id: "step-1",
      targets: [{ kind: "card", id: "target" }],
      viewport: { x: 1, y: 2, zoom: 1 },
      caption: "from the document",
    });

    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
        tourStep: {
          group: "block",
          atom: true,
          attrs: { stepId: {}, targets: {}, viewport: {}, caption: {}, advance: {} },
        },
      },
    });
    const content = workspace.peekContent("tour");
    if (!content) throw new Error("no body");
    const node = createNodeFromLoroObj(schema, content as unknown as LoroNode, new Map());
    if (node === null || Array.isArray(node)) throw new Error("no document node");

    const [step] = stepNodes(node);
    expect(parseStep(step?.attrs)?.caption).toBe("from the document");
    expect(parseStep(step?.attrs)?.targets).toEqual([{ kind: "card", id: "target" }]);
  });
});
