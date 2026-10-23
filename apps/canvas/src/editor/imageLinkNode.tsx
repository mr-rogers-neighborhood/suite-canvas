import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { ImageLinkView } from "./ImageLinkView";

export const IMAGE_NODE_NAME = "image";

/**
 * Caps the node keeps, mirrored by the publish allowlist. A link is a line of
 * text the document carries, so it is bounded like one; an alt is a label.
 */
export const IMAGE_URL_MAX_LENGTH = 2048;
export const IMAGE_ALT_MAX_LENGTH = 200;

/** Paths that read as a picture, which is how a pasted URL is recognized. */
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/iu;

function decodeFileName(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Why a value cannot be an image link, in the words the prompt shows. `null`
 * means the value is usable. The publish validator keeps its own copy of these
 * rules because the graph package cannot import the editor's schema.
 */
export function imageLinkProblem(value: unknown): string | null {
  if (typeof value !== "string") return "Enter an image URL.";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Enter an image URL.";
  if (trimmed.length > IMAGE_URL_MAX_LENGTH) {
    return `Use a link shorter than ${IMAGE_URL_MAX_LENGTH} characters.`;
  }
  for (const character of trimmed) {
    if (character.charCodeAt(0) <= 0x20) return "A link cannot contain spaces.";
  }
  if (!/^https?:\/\//iu.test(trimmed)) return "Only http and https links can be shown.";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Only http and https links can be shown.";
    }
    return null;
  } catch {
    return "That is not a valid URL.";
  }
}

/** The URL an image node may store, normalized, or null when it may not store it. */
export function imageLinkSrc(value: unknown): string | null {
  if (typeof value !== "string" || imageLinkProblem(value) !== null) return null;
  return new URL(value.trim()).href;
}

/**
 * The URL to read from pasted text, or null when the paste is not one image
 * link. The whole clipboard must be the URL: a paragraph that happens to
 * contain a link is prose the user is pasting, not a picture to place.
 */
export function imageLinkFromText(text: string): string | null {
  const trimmed = text.trim();
  // A bare URL has no whitespace at all; everything else stays a normal paste.
  if (/\s/u.test(trimmed)) return null;
  const src = imageLinkSrc(trimmed);
  if (src === null) return null;
  let pathname: string;
  try {
    pathname = new URL(src).pathname;
  } catch {
    return null;
  }
  return IMAGE_PATH.test(pathname) ? src : null;
}

/** Alt text from the link's last path segment; a URL still needs a label. */
export function imageAltFromSrc(src: string): string {
  try {
    const segments = new URL(src).pathname.split("/").filter((part) => part.length > 0);
    const name = decodeFileName(segments.at(-1) ?? "");
    return name.length > 0 ? name.slice(0, IMAGE_ALT_MAX_LENGTH) : "Linked image";
  } catch {
    return "Linked image";
  }
}

function attribute(name: string, htmlName: string) {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const value = element.getAttribute(htmlName);
      if (value === null) return null;
      if (name === "width" || name === "height") {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : null;
      }
      return value;
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[name];
      return value === null || value === undefined ? {} : { [htmlName]: String(value) };
    },
  };
}

/**
 * A picture the user *places*, addressed by URL rather than by stored bytes.
 *
 * Block, not inline: unlike a mention or a property chip, a picture is a thing
 * on its own line — it has intrinsic dimensions, it is what Enter should step
 * past, and the placeholder needs room for the URL. Inline would also let a
 * click land in the middle of the `img` atom, which the schema cannot represent.
 *
 * The node holds no bytes, so it works in every edition: a standalone build
 * with no relay renders it exactly as a collaborative one does. The cost is
 * that the *viewer's* browser fetches from a third party — see
 * `ImageLinkView` for the referrer and error handling that fact requires.
 */
export const ImageLink = Node.create({
  name: IMAGE_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      /** The picture's address. Only http and https ever reach an `img`. */
      src: attribute("src", "src"),
      /** Alt text. Empty is allowed and means "decorative" to a screen reader. */
      alt: attribute("alt", "alt"),
      /** Natural size when the source knows it, so a lazy image reserves space. */
      width: attribute("width", "width"),
      height: attribute("height", "height"),
    };
  },

  parseHTML() {
    return [
      {
        // The attachment node also renders an `img`, so its id-marked tag is
        // claimed there; this rule only takes a plain picture.
        tag: "img[src]:not([data-attachment-id])",
        getAttrs: (element) => {
          const src = imageLinkSrc((element as HTMLElement).getAttribute("src"));
          return src === null ? false : null;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = imageLinkSrc(node.attrs.src);
    const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
    // Copy, paste and any HTML export carry the privacy attributes too, so the
    // guarantee does not depend on which surface a reader happens to use.
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        src: src ?? "",
        alt,
        referrerpolicy: "no-referrer",
        loading: "lazy",
        decoding: "async",
        "data-image-link": "",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageLinkView);
  },
});

/**
 * Inserts a link node after the block `pos` falls in, leaving an empty
 * paragraph after it so typing can continue.
 *
 * A block cannot sit inside a paragraph, so the caret's block is the anchor:
 * the picture lands after it. Everything runs against one transaction, which
 * also keeps the insert position stable while a prompt holds a caret.
 */
export function insertImageNodeAt(view: EditorView, pos: number, src: string): boolean {
  if (view.isDestroyed) return false;
  const type = view.state.schema.nodes[IMAGE_NODE_NAME];
  const paragraph = view.state.schema.nodes.paragraph;
  if (!type) return false;
  try {
    const at = view.state.doc.resolve(Math.max(0, Math.min(pos, view.state.doc.content.size)));
    const insertAt = at.depth === 0 ? at.pos : at.after(1);
    const node = type.create({ src, alt: imageAltFromSrc(src) });
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
    console.warn("[images] could not insert the image link here", error);
    return false;
  }
}
