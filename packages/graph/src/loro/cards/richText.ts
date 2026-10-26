import { type LoroList, LoroMap, LoroText, type Value } from "loro-crdt";
import type { PortableNode } from "../../portable.js";
import { ALLOWED_MARKS, ALLOWED_NODES } from "../../publish/validation/richTextSchema.js";
import { loroAttributes, loroChildren } from "../../records/containers.js";
import { STRUCT_ORIGIN } from "../constants.js";
import type { DocContext } from "../context.js";

/**
 * Owns writing a whole rich-text tree: the shape an importer, a template or a
 * paste has in hand before any editor has mounted. Every other writer in this
 * package touches one leaf; this one replaces a title or a body, so it says so
 * in the origin it commits under.
 *
 * The node shape is `PortableNode`, the same one `loroTreeToJson` reads, so a
 * tree written here reads back unchanged.
 */

export const RICH_TEXT_ORIGIN = `${STRUCT_ORIGIN}write-rich-text`;

/** One text run of a paragraph, in the order it should appear. */
export interface TextRun {
  text: string;
  /** Mark names from the editor schema; `link` carries an `href`. */
  marks?: ReadonlyArray<{ type: string; attrs?: Record<string, unknown> }>;
}

const BLOCK_NODE_NAMES = new Set(["paragraph", "heading", "codeBlock", "blockquote"]);

function nodePath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function assertNode(node: PortableNode, path: string): void {
  if (!ALLOWED_NODES.has(node.type)) {
    throw new Error(`${path} is a "${node.type}" node, which the editor cannot render`);
  }
  for (const mark of node.marks ?? []) {
    if (!ALLOWED_MARKS.has(mark.type)) {
      throw new Error(`${path} carries the "${mark.type}" mark, which the editor cannot render`);
    }
  }
  for (const [index, child] of (node.content ?? []).entries()) {
    assertNode(child, nodePath(path, index));
  }
}

/** A mark's delta attributes, which is where `loro-prosemirror` stores them. */
function markAttributes(marks: PortableNode["marks"]): Record<string, Value> | null {
  const attributes: Record<string, Value> = {};
  for (const mark of marks ?? []) {
    attributes[mark.type] = (mark.attrs ?? true) as Value;
  }
  return Object.keys(attributes).length > 0 ? attributes : null;
}

function writeText(children: LoroList, index: number, node: PortableNode): void {
  const text = children.insertContainer(index, new LoroText());
  if (node.text) {
    const attributes = markAttributes(node.marks);
    if (attributes) text.applyDelta([{ insert: node.text, attributes }]);
    else text.insert(0, node.text);
  }
}

function writeNode(children: LoroList, index: number, node: PortableNode): void {
  if (node.type === "text") {
    writeText(children, index, node);
    return;
  }
  if (node.type === "hardBreak" || node.type === "horizontalRule") {
    const atom = children.insertContainer(index, new LoroMap());
    atom.set("nodeName", node.type);
    loroAttributes(atom);
    return;
  }
  const container = children.insertContainer(index, new LoroMap());
  container.set("nodeName", node.type);
  const attributes = loroAttributes(container);
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    if (value !== undefined) attributes.set(key, value as Value);
  }
  const nested = loroChildren(container);
  for (const [childIndex, child] of (node.content ?? []).entries()) {
    writeNode(nested, childIndex, child);
  }
}

function replaceChildren(parent: LoroMap, nodes: readonly PortableNode[]): void {
  for (const [index, node] of nodes.entries()) assertNode(node, `nodes[${index}]`);
  parent.set("nodeName", "doc");
  loroAttributes(parent);
  const children = loroChildren(parent);
  if (children.length > 0) children.delete(0, children.length);
  for (const [index, node] of nodes.entries()) writeNode(children, index, node);
}

/** A paragraph node holding one text run, the shape most callers need. */
export function paragraphNode(runs: readonly TextRun[] | string): PortableNode {
  const list = typeof runs === "string" ? [{ text: runs }] : runs;
  const content = list
    .filter((run) => run.text.length > 0)
    .map((run) => ({
      type: "text",
      text: run.text,
      ...(run.marks && run.marks.length > 0 ? { marks: [...run.marks] } : {}),
    }));
  return { type: "paragraph", ...(content.length > 0 ? { content } : {}) };
}

/** Nodes for plain text: one paragraph per line, empty lines kept as empty paragraphs. */
export function textNodes(text: string): PortableNode[] {
  const lines = text.split("\n");
  return lines.map((line) => paragraphNode(line));
}

export function richTextMethods(ctx: DocContext) {
  return {
    /** Replaces a card's title with a tree. False for a card that is gone. */
    setTitleNodes(cardId: string, nodes: readonly PortableNode[]): boolean {
      if (!ctx.api.cards.getCard(cardId)) return false;
      replaceChildren(ctx.api.cards.getTitle(cardId), nodes);
      ctx.commit(RICH_TEXT_ORIGIN);
      return true;
    },

    /** Replaces a card's body with a tree. False for a card that is gone. */
    setBodyNodes(cardId: string, nodes: readonly PortableNode[]): boolean {
      if (!ctx.api.cards.getCard(cardId)) return false;
      replaceChildren(ctx.api.cards.getContent(cardId), nodes);
      ctx.commit(RICH_TEXT_ORIGIN);
      return true;
    },

    /** One-line title: the common case for an imported note or a template card. */
    setTitleText(cardId: string, title: string): boolean {
      return ctx.api.cards.setTitleNodes(cardId, [paragraphNode(title)]);
    },

    /** Body from plain text, one paragraph per line. */
    setBodyText(cardId: string, body: string): boolean {
      return ctx.api.cards.setBodyNodes(cardId, textNodes(body));
    },

    /** True when the node is a block the body may hold directly. */
    isBlockNodeName(name: string): boolean {
      return BLOCK_NODE_NAMES.has(name);
    },
  };
}
