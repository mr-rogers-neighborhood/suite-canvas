import { type Node as PMNode, Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { LoroDoc } from "loro-crdt";
import {
  createNodeFromLoroObj,
  type LoroDocType,
  type LoroNode,
  ROOT_DOC_KEY,
  updateLoroToPmState,
} from "loro-prosemirror";
import { describe, expect, it } from "vitest";

/**
 * Spike: does `loro-prosemirror` round-trip an inline atom node with attributes,
 * including two clients inserting atoms at the same position concurrently?
 * Everything about mentions (and property blocks) depends on the answer.
 */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    mention: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { cardId: {} },
      selectable: false,
      draggable: false,
    },
  },
});

const paragraph = (children: PMNode[]) => schema.node("paragraph", null, children);
const mention = (cardId: string) => schema.node("mention", { cardId });
const docWith = (children: PMNode[]) => schema.node("doc", null, children);

function push(doc: LoroDoc, pmDoc: PMNode): void {
  const state = EditorState.create({ schema, doc: pmDoc });
  // `loro-prosemirror` types the document as its own generic container shape;
  // a plain LoroDoc is the same runtime object.
  updateLoroToPmState(doc as unknown as LoroDocType, new Map(), state, undefined, "text:body");
}

/** Reads the document back the way a peer's editor would after an import. */
function pull(doc: LoroDoc): PMNode {
  return createNodeFromLoroObj(
    schema,
    doc.getMap(ROOT_DOC_KEY) as unknown as LoroNode,
    new Map(),
  ) as PMNode;
}

describe("loro atom nodes", () => {
  it("should round-trip an inline atom with attributes", () => {
    const doc = new LoroDoc();
    const original = docWith([
      paragraph([schema.text("See "), mention("card-1"), schema.text(" for context.")]),
      paragraph([mention("card-2")]),
    ]);

    push(doc, original);

    expect(pull(doc).eq(original)).toBe(true);
  });

  it("should update an atom's attribute without disturbing its neighbours", () => {
    const doc = new LoroDoc();
    push(doc, docWith([paragraph([schema.text("a"), mention("card-1"), schema.text("b")])]));

    const updated = docWith([paragraph([schema.text("a"), mention("card-9"), schema.text("b")])]);
    push(doc, updated);

    const rebuilt = pull(doc);
    expect(rebuilt.eq(updated)).toBe(true);
    expect(rebuilt.textContent).toBe("ab");
  });

  it("should keep both atoms when two clients insert at the same position", () => {
    const a = new LoroDoc();
    const b = new LoroDoc();
    push(a, docWith([paragraph([schema.text("Start ")])]));
    b.import(a.export({ mode: "update" }));

    push(a, docWith([paragraph([schema.text("Start "), mention("from-a")])]));
    push(b, docWith([paragraph([schema.text("Start "), mention("from-b")])]));

    a.import(b.export({ mode: "update" }));
    b.import(a.export({ mode: "update" }));

    const collect = (doc: LoroDoc) => {
      const ids: string[] = [];
      pull(doc).descendants((node) => {
        if (node.type.name === "mention") ids.push(node.attrs.cardId as string);
        return true;
      });
      return ids.sort();
    };

    expect(collect(a)).toEqual(["from-a", "from-b"]);
    expect(collect(b)).toEqual(["from-a", "from-b"]);
  });

  it("should drop an atom when the text around it is replaced", () => {
    const doc = new LoroDoc();
    push(doc, docWith([paragraph([schema.text("a"), mention("card-1")])]));

    push(doc, docWith([paragraph([schema.text("ab")])]));

    const rebuilt = pull(doc);
    expect(rebuilt.textContent).toBe("ab");
    let mentions = 0;
    rebuilt.descendants((node) => {
      if (node.type.name === "mention") mentions += 1;
      return true;
    });
    expect(mentions).toBe(0);
  });
});
