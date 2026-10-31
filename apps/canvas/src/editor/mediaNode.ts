import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { ATTACHMENT_ID_PATTERN, attachmentUrl } from "./attachmentNode";
import { MediaView } from "./MediaView";

export const MEDIA_NODE_NAME = "media";

/**
 * How a media block is drawn. Not how it gets its bytes: an image is an image
 * whether the bytes sit on a relay (`id`) or at a third-party address (`src`),
 * so the schema says "image" and the node's own data says which.
 */
export const mediaKinds = ["image", "video", "youtube"] as const;

export type MediaKind = (typeof mediaKinds)[number];

/** Coerces an attribute the editor writes, so a hand-edited document cannot lie. */
export function mediaKindOf(value: unknown): MediaKind {
  return typeof value === "string" && (mediaKinds as readonly string[]).includes(value)
    ? (value as MediaKind)
    : "image";
}

/** True when this node names bytes stored beside the document. */
export function hasStoredBytes(attrs: Record<string, unknown>): boolean {
  return typeof attrs.id === "string" && ATTACHMENT_ID_PATTERN.test(attrs.id);
}

/**
 * One attribute, read from and written to the `data-` name the node renders.
 *
 * Numeric attributes are the ones a projection measures with; a value that is
 * not a finite non-negative number is treated as absent rather than coerced to
 * zero, because zero is a size the reader would believe.
 */
function mediaAttribute(name: string, dataName: string, numeric: boolean) {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const value = element.getAttribute(dataName);
      if (value === null) return null;
      if (numeric) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
      }
      return value;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[name];
      return value === null || value === undefined ? {} : { [dataName]: String(value) };
    },
  };
}

/**
 * A picture, a video, or an embed, as one block.
 *
 * This supersedes `attachment`, `image`, `video` and `youtube` without removing
 * them: those four stay in the schema so documents written before this node
 * still render, and the editor converts one to a `media` block the first time a
 * reader edits the body that holds it. New content is only ever written as
 * `media`.
 *
 * Block, not inline. The four it replaces disagreed — `attachment` was inline
 * while the rest were blocks — and the inline shape is the one that hurts: an
 * inline atom lets a click land inside the picture, which the schema cannot
 * represent, and a video inside a paragraph has nowhere to put its controls.
 */
export const Media = Node.create({
  name: MEDIA_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      /** Which renderer draws it: `image`, `video` or `youtube`. */
      kind: {
        default: "image",
        parseHTML: (element: HTMLElement) => mediaKindOf(element.getAttribute("data-media-kind")),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-media-kind": mediaKindOf(attributes.kind),
        }),
      },
      /** Relay id of stored bytes. Metadata only; the pixels are never here. */
      id: mediaAttribute("id", "data-attachment-id", false),
      mime: mediaAttribute("mime", "data-attachment-mime", false),
      width: mediaAttribute("width", "data-attachment-width", true),
      height: mediaAttribute("height", "data-attachment-height", true),
      /** Alt text for an image, and the label every kind falls back to. */
      name: mediaAttribute("name", "data-attachment-name", false),
      /** Byte count, so a projection can size the card without the bytes. */
      bytes: mediaAttribute("bytes", "data-attachment-bytes", true),
      duration: mediaAttribute("duration", "data-attachment-duration", true),
      /** A link image's address. Only http and https ever reach an `img`. */
      src: mediaAttribute("src", "src", false),
      alt: mediaAttribute("alt", "alt", false),
      /** A YouTube embed's id and privacy-enhanced source. */
      videoId: mediaAttribute("videoId", "data-youtube-video", false),
      title: mediaAttribute("title", "title", false),
    };
  },

  parseHTML() {
    // Only this node's own markers. The four legacy nodes still own their tags,
    // and a parse rule that stole them would make an HTML round trip depend on
    // which extension Tiptap happened to consult first.
    return [{ tag: "[data-media-kind]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = mediaKindOf(node.attrs.kind);
    const id = typeof node.attrs.id === "string" ? node.attrs.id : "";

    if (kind === "video") {
      return [
        "video",
        mergeAttributes(HTMLAttributes, {
          "data-media-kind": "video",
          src: id.length > 0 ? attachmentUrl(id) : null,
          controls: "true",
        }),
      ];
    }

    if (kind === "youtube") {
      const videoId = typeof node.attrs.videoId === "string" ? node.attrs.videoId : "";
      const src =
        typeof node.attrs.src === "string" && node.attrs.src.length > 0
          ? node.attrs.src
          : `https://www.youtube-nocookie.com/embed/${videoId}`;
      return [
        "div",
        mergeAttributes(HTMLAttributes, { "data-media-kind": "youtube" }),
        [
          "iframe",
          {
            src,
            title: typeof node.attrs.title === "string" ? node.attrs.title : "YouTube video",
            frameborder: "0",
            allow:
              "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
            allowfullscreen: "true",
            style: "width: 100%; aspect-ratio: 16/9; border-radius: 8px;",
          },
        ],
      ];
    }

    // An image is drawn from stored bytes when it has an id, and from its own
    // address otherwise. `no-referrer` travels with the copy, so the guarantee
    // does not depend on which surface a reader happens to use.
    const src =
      id.length > 0 ? attachmentUrl(id) : typeof node.attrs.src === "string" ? node.attrs.src : "";
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        "data-media-kind": "image",
        src,
        alt: typeof node.attrs.alt === "string" ? node.attrs.alt : "",
        referrerpolicy: "no-referrer",
        loading: "lazy",
        decoding: "async",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaView);
  },
});

/** The attributes a new media block is built from; every one is optional. */
export type MediaAttrs = Record<string, string | number | null>;

/**
 * Inserts one media block at the current selection.
 *
 * A block replaces the block the caret is in — the same shape `insertVideo`
 * used — so a picture dropped into a paragraph takes that paragraph's place
 * rather than nesting inside it, which the schema would refuse.
 */
export function insertMediaNode(view: EditorView, attrs: MediaAttrs): boolean {
  if (view.isDestroyed) return false;
  const type = view.state.schema.nodes[MEDIA_NODE_NAME];
  if (!type) return false;
  try {
    view.dispatch(
      view.state.tr
        .replaceSelectionWith(type.create({ ...attrs, kind: mediaKindOf(attrs.kind) }))
        .scrollIntoView(),
    );
    return true;
  } catch (error) {
    console.warn("[media] could not insert the media block here", error);
    return false;
  }
}

/**
 * Inserts a media block after the block `pos` falls in, then leaves an empty
 * paragraph so typing can continue.
 *
 * Same anchor rule as the image link: a block cannot sit inside a paragraph, and
 * running the whole insert in one transaction keeps the position stable while a
 * prompt holds the caret.
 */
export function insertMediaAfter(view: EditorView, pos: number, attrs: MediaAttrs): boolean {
  if (view.isDestroyed) return false;
  const type = view.state.schema.nodes[MEDIA_NODE_NAME];
  const paragraph = view.state.schema.nodes.paragraph;
  if (!type) return false;
  try {
    const at = view.state.doc.resolve(Math.max(0, Math.min(pos, view.state.doc.content.size)));
    const insertAt = at.depth === 0 ? at.pos : at.after(1);
    const node = type.create({ ...attrs, kind: mediaKindOf(attrs.kind) });
    let transaction = view.state.tr.insert(insertAt, node);
    if (paragraph) {
      const next = paragraph.createAndFill();
      if (next) {
        transaction = transaction.setSelection(
          TextSelection.create(
            transaction.insert(insertAt + node.nodeSize, next).doc,
            insertAt + node.nodeSize + 1,
          ),
        );
      }
    }
    view.dispatch(transaction.scrollIntoView());
    return true;
  } catch (error) {
    console.warn("[media] could not insert the media block here", error);
    return false;
  }
}
