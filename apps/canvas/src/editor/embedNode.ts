import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { EmbedView } from "./EmbedView";

export const EMBED_NODE_NAME = "embed";

/** The size an embed starts at, and the bounds a reader may drag it between. */
export const EMBED_DEFAULT_SIZE = { width: 320, height: 200 } as const;
export const EMBED_MIN_SIZE = { width: 160, height: 96 } as const;
export const EMBED_MAX_SIZE = { width: 720, height: 560 } as const;

function bounded(value: unknown, min: number, max: number): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(Math.max(Math.round(number), min), max);
}

/**
 * A card shown inside another card.
 *
 * Block, not inline: an embed is a figure with its own size, and the reader resizes it
 * where it sits. `cardId` is the whole of what it stores about the other card, so the
 * embed follows edits and can never hold a stale copy.
 */
export const Embed = Node.create({
  name: EMBED_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    const size = (name: "width" | "height") => ({
      default: null,
      parseHTML: (element: HTMLElement) => {
        const raw = element.getAttribute(`data-embed-${name}`);
        return raw === null ? null : bounded(raw, 0, Number.MAX_SAFE_INTEGER);
      },
      renderHTML: (attributes: Record<string, unknown>) => {
        const value = attributes[name];
        return value === null || value === undefined
          ? {}
          : { [`data-embed-${name}`]: String(value) };
      },
    });

    return {
      /** The card this shows. Empty means the reader has not chosen one yet. */
      cardId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-embed-card"),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.cardId === "string" && attributes.cardId.length > 0
            ? { "data-embed-card": attributes.cardId }
            : {},
      },
      width: size("width"),
      height: size("height"),
    };
  },

  parseHTML() {
    return [{ tag: "[data-embed-card]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const width = bounded(node.attrs.width, EMBED_MIN_SIZE.width, EMBED_MAX_SIZE.width);
    const height = bounded(node.attrs.height, EMBED_MIN_SIZE.height, EMBED_MAX_SIZE.height);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-embed-card": typeof node.attrs.cardId === "string" ? node.attrs.cardId : "",
        "data-embed-width": width === null ? null : String(width),
        "data-embed-height": height === null ? null : String(height),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});
