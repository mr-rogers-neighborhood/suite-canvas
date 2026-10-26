import type { PortableNode } from "@suite/graph";
import type { BlockToken, InlineToken, MarkName } from "./markdown.js";

/**
 * Owns turning a parsed note into the rich-text nodes the graph writes.
 *
 * Every link is resolved here, which is why the note is parsed before any card
 * is written: a wikilink can only become a mention once its target has an id.
 */

export interface LinkResolver {
  /** The card a wikilink target names, with whether the name was ambiguous. */
  resolve: (target: string) => { cardId: string | null; ambiguous: boolean };
}

export interface ConvertedNote {
  nodes: PortableNode[];
  resolved: number;
  unresolved: string[];
  ambiguous: string[];
  /** Embedded file paths, kept as text because their bytes are not imported. */
  embeds: string[];
  /** Addresses a link mark refused, because only http, https and mailto are safe. */
  refusedLinks: string[];
}

const SAFE_HREF = /^(?:https?|mailto):/iu;

function markNodes(marks: readonly MarkName[]): Array<{ type: string }> {
  return marks.map((mark) => ({ type: mark }));
}

function textNode(text: string, marks: readonly MarkName[] = []): PortableNode {
  return { type: "text", text, ...(marks.length > 0 ? { marks: markNodes(marks) } : {}) };
}

interface InlineResult {
  nodes: PortableNode[];
  embeds: string[];
  refusedLinks: string[];
  resolved: number;
  unresolved: string[];
  ambiguous: string[];
}

function convertInline(
  tokens: readonly InlineToken[],
  resolver: LinkResolver,
  sink: InlineResult,
): PortableNode[] {
  const nodes: PortableNode[] = [];
  for (const token of tokens) {
    switch (token.kind) {
      case "text":
        if (token.text.length > 0) nodes.push(textNode(token.text, token.marks));
        break;
      case "tag":
        // The tag becomes a tag on the card; leaving it in the sentence too would
        // read as a stray `#` once the chip exists.
        break;
      case "embed":
        sink.embeds.push(token.target);
        nodes.push(textNode(token.target));
        break;
      case "link":
        if (SAFE_HREF.test(token.href)) {
          nodes.push({
            type: "text",
            text: token.text.length > 0 ? token.text : token.href,
            marks: [{ type: "link", attrs: { href: token.href } }],
          });
        } else {
          sink.refusedLinks.push(token.href);
          if (token.text.length > 0) nodes.push(textNode(token.text));
        }
        break;
      case "wikilink": {
        const { cardId, ambiguous } = resolver.resolve(token.target);
        const trailing = token.alias ?? token.heading;
        if (ambiguous) sink.ambiguous.push(token.target);
        if (cardId) {
          sink.resolved += 1;
          nodes.push({ type: "mention", attrs: { cardId } });
          if (trailing) nodes.push(textNode(` ${trailing}`));
        } else {
          if (!sink.unresolved.includes(token.target)) sink.unresolved.push(token.target);
          nodes.push(textNode(token.alias ? token.alias : `[[${token.target}]]`));
        }
        break;
      }
    }
  }
  return nodes;
}

/** A block node, with `content` left out when it is empty so nothing is a shell. */
function block(
  type: string,
  content: PortableNode[],
  attrs?: Record<string, unknown>,
): PortableNode {
  return {
    type,
    ...(attrs && Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(content.length > 0 ? { content } : {}),
  };
}

interface ListItem {
  ordered: boolean;
  depth: number;
  content: PortableNode[];
}

/**
 * Nests list items by their indentation. The parser already turned leading spaces
 * into a depth; a jump of more than one step lands at the depth it asked for,
 * because a deeper list with no parent item has nowhere else to go.
 */
function listNodes(items: readonly ListItem[]): PortableNode[] {
  const roots: PortableNode[] = [];
  const stack: Array<{ depth: number; list: PortableNode }> = [];

  const listFor = (ordered: boolean): PortableNode =>
    block(ordered ? "orderedList" : "bulletList", []);

  const isOrdered = (list: PortableNode): boolean => list.type === "orderedList";

  /** Appends a list one level down: inside the last item, else at the top. */
  const appendUnderParent = (list: PortableNode): void => {
    const parent = stack.at(-1);
    if (!parent) {
      roots.push(list);
      return;
    }
    const parentItem = parent.list.content?.at(-1);
    if (parentItem) {
      parentItem.content = [...(parentItem.content ?? []), list];
      return;
    }
    parent.list.content = [...(parent.list.content ?? []), block("listItem", [list])];
  };

  for (const item of items) {
    while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) > item.depth) stack.pop();

    const top = stack.at(-1);
    if (!top) {
      const list = listFor(item.ordered);
      roots.push(list);
      stack.push({ depth: item.depth, list });
    } else if (top.depth < item.depth) {
      const nested = listFor(item.ordered);
      appendUnderParent(nested);
      stack.push({ depth: item.depth, list: nested });
    } else if (isOrdered(top.list) !== item.ordered) {
      // A switch between bullet and numbered at one depth is a sibling list.
      stack.pop();
      const sibling = listFor(item.ordered);
      appendUnderParent(sibling);
      stack.push({ depth: item.depth, list: sibling });
    }

    const active = stack.at(-1);
    if (!active) continue;
    active.list.content = [
      ...(active.list.content ?? []),
      block("listItem", [block("paragraph", item.content)]),
    ];
  }
  return roots;
}

/** Converts a whole note body, collecting what the report needs to say. */
export function blocksToNodes(
  blocks: readonly BlockToken[],
  resolver: LinkResolver,
): ConvertedNote {
  const sink: InlineResult = {
    nodes: [],
    embeds: [],
    refusedLinks: [],
    resolved: 0,
    unresolved: [],
    ambiguous: [],
  };
  const nodes: PortableNode[] = [];
  let pending: ListItem[] = [];

  const flushList = () => {
    if (pending.length === 0) return;
    nodes.push(...listNodes(pending));
    pending = [];
  };

  for (const token of blocks) {
    if (token.kind !== "list") flushList();
    switch (token.kind) {
      case "paragraph": {
        const content = convertInline(token.inline, resolver, sink);
        if (content.length > 0) nodes.push(block("paragraph", content));
        break;
      }
      case "heading":
        nodes.push(
          block("heading", convertInline(token.inline, resolver, sink), { level: token.level }),
        );
        break;
      case "quote":
        nodes.push(
          block("blockquote", [block("paragraph", convertInline(token.inline, resolver, sink))]),
        );
        break;
      case "code":
        nodes.push(
          block(
            "codeBlock",
            [textNode(token.text)],
            token.language ? { language: token.language } : undefined,
          ),
        );
        break;
      case "rule":
        nodes.push({ type: "horizontalRule" });
        break;
      case "list":
        pending.push({
          ordered: token.ordered,
          depth: token.depth,
          content: convertInline(token.inline, resolver, sink),
        });
        break;
    }
  }
  flushList();

  return {
    nodes,
    resolved: sink.resolved,
    unresolved: sink.unresolved,
    ambiguous: sink.ambiguous,
    embeds: sink.embeds,
    refusedLinks: sink.refusedLinks,
  };
}
