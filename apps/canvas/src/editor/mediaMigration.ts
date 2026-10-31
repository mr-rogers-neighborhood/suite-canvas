import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { MEDIA_NODE_NAME } from "./mediaNode";

/** The four nodes `media` supersedes, and the kind each becomes. */
const LEGACY_KINDS: Record<string, "image" | "video" | "youtube"> = {
  attachment: "image",
  image: "image",
  video: "video",
  youtube: "youtube",
};

/** Copy an attribute only when the legacy node actually carried a value. */
function pick(source: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const name of names) {
    const value = source[name];
    if (value !== null && value !== undefined) attrs[name] = value;
  }
  return attrs;
}

/**
 * The media attributes a legacy node becomes, or null when it cannot be mapped
 * faithfully.
 *
 * A node carrying nothing the media block can express is left alone; dropping
 * it would delete media the reader can still see, which is worse than leaving
 * one legacy node in the tree.
 */
export function mediaAttrsFromLegacy(node: ProseMirrorNode): Record<string, unknown> | null {
  const base = LEGACY_KINDS[node.type.name];
  if (base === undefined) return null;

  if (node.type.name === "attachment") {
    const mime = typeof node.attrs.mime === "string" ? node.attrs.mime : "";
    return {
      kind: mime.startsWith("video/") ? "video" : "image",
      ...pick(node.attrs, ["id", "mime", "width", "height", "name", "bytes"]),
    };
  }

  if (node.type.name === "image") {
    if (typeof node.attrs.src !== "string" || node.attrs.src.length === 0) return null;
    return { kind: "image", ...pick(node.attrs, ["src", "alt", "width", "height"]) };
  }

  if (node.type.name === "video") {
    return {
      kind: "video",
      ...pick(node.attrs, ["id", "mime", "width", "height", "name", "bytes", "duration"]),
    };
  }

  // youtube
  if (typeof node.attrs.videoId !== "string" || node.attrs.videoId.length === 0) return null;
  return { kind: "youtube", ...pick(node.attrs, ["videoId", "src", "title", "width", "height"]) };
}

interface Replacement {
  from: number;
  to: number;
  attrs: Record<string, unknown>;
}

/**
 * Rewrites every legacy media node in `state` to a `media` block.
 *
 * Returns null when there is nothing to do, so an untouched body produces no
 * transaction and no undo entry. Positions are collected first and applied
 * back to front, because each replacement changes the offsets the others are
 * measured from.
 *
 * An inline `attachment` is the one shape with no straight swap: `media` is a
 * block, so it cannot stay inside a paragraph. It converts only when it is the
 * whole paragraph — the shape a pasted image actually has — and is otherwise
 * left as it is. A paragraph holding text beside a picture is a document the
 * reader wrote, not a shape to rewrite on their behalf.
 */
export function migrateLegacyMedia(state: EditorState): Transaction | null {
  const mediaType = state.schema.nodes[MEDIA_NODE_NAME];
  if (!mediaType) return null;

  const replacements: Replacement[] = [];

  state.doc.descendants((node, pos) => {
    if (LEGACY_KINDS[node.type.name] === undefined) return true;

    const attrs = mediaAttrsFromLegacy(node);
    if (attrs === null) return false;

    if (node.isInline) {
      const parent = state.doc.resolve(pos).parent;
      const alone =
        parent.childCount === 1 &&
        (parent.type.name === "paragraph" || parent.type.name === "heading");
      if (!alone) return false;
      const start = pos - 1;
      replacements.push({ from: start, to: start + parent.nodeSize, attrs });
      return false;
    }

    replacements.push({ from: pos, to: pos + node.nodeSize, attrs });
    return false;
  });

  if (replacements.length === 0) return null;

  const transaction = state.tr;
  for (const replacement of replacements.reverse()) {
    try {
      transaction.replaceWith(
        replacement.from,
        replacement.to,
        mediaType.create(replacement.attrs),
      );
    } catch {
      // A position the schema refuses is a body left as it was, never a body
      // with a hole in it.
      transaction.setMeta("mediaMigrationSkipped", true);
    }
  }

  return transaction.docChanged ? transaction : null;
}
