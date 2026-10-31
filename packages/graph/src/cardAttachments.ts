/**
 * Owns "which images does this workspace reference, and where do they appear".
 *
 * The bytes of an attachment live beside the document (local store or relay),
 * never inside it, so anything that has to find them — the backup export, the
 * relay's own admin export, and the future garbage collector — has to read the
 * card bodies first. Keeping that walk in the core means the client and the
 * server cannot disagree about which ids exist, which is how an export silently
 * loses an image.
 *
 * It reads only; nothing here writes to a document.
 */

import type { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { loroTreeToJson, type PortableNode } from "./portable.js";

/** A card body's image reference, with every card that shows it. */
export interface CardAttachment {
  id: string;
  mime: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
  /** Every card whose body (or title) contains the node; titles are for humans. */
  cards: Array<{ id: string; title: string }>;
}

export type MediaKind = "image" | "video" | "youtube";

/** A media reference in the workspace (image, video, YouTube embed). */
export interface WorkspaceMediaItem {
  id: string;
  kind: MediaKind;
  url: string | null;
  mime: string | null;
  name: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  duration: number | null;
  videoId: string | null;
  cards: Array<{ id: string; title: string }>;
}

/** The editor's image and video attachment nodes. */
const ATTACHMENT_NODE = "attachment";
const VIDEO_NODE = "video";
const IMAGE_NODE = "image";
const YOUTUBE_NODE = "youtube";

function dimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function visitMedia(
  nodes: readonly PortableNode[],
  visit: (type: string, attributes: Record<string, unknown>) => void,
): void {
  for (const node of nodes) {
    if (
      node.type === ATTACHMENT_NODE ||
      node.type === VIDEO_NODE ||
      node.type === IMAGE_NODE ||
      node.type === YOUTUBE_NODE
    ) {
      visit(node.type, node.attrs ?? {});
    }
    if (node.content) visitMedia(node.content, visit);
  }
}

function visitAttachments(
  nodes: readonly PortableNode[],
  visit: (attributes: Record<string, unknown>) => void,
): void {
  for (const node of nodes) {
    if (node.type === ATTACHMENT_NODE || node.type === VIDEO_NODE) visit(node.attrs ?? {});
    if (node.content) visitAttachments(node.content, visit);
  }
}

/**
 * Every media item (images, videos, embeds) the document's card bodies reference.
 */
export function documentMedia(workspace: WorkspaceDocument): WorkspaceMediaItem[] {
  const byId = new Map<string, WorkspaceMediaItem>();
  for (const card of workspace.listCards()) {
    const title = workspace.displayTitle(card.id);
    for (const nodes of [workspace.peekTitle(card.id), workspace.peekContent(card.id)]) {
      visitMedia(loroTreeToJson(nodes), (type, attributes) => {
        const id =
          typeof attributes.id === "string" && attributes.id.length > 0
            ? attributes.id
            : typeof attributes.videoId === "string" && attributes.videoId.length > 0
              ? `yt_${attributes.videoId}`
              : typeof attributes.src === "string" && attributes.src.length > 0
                ? attributes.src
                : "";
        if (id.length === 0) return;
        const existing = byId.get(id);
        if (existing) {
          if (!existing.cards.some((entry) => entry.id === card.id)) {
            existing.cards.push({ id: card.id, title });
          }
          return;
        }

        const mime = typeof attributes.mime === "string" ? attributes.mime : null;
        const name =
          typeof attributes.name === "string"
            ? attributes.name
            : typeof attributes.title === "string"
              ? attributes.title
              : typeof attributes.alt === "string"
                ? attributes.alt
                : null;
        const kind: MediaKind =
          type === YOUTUBE_NODE
            ? "youtube"
            : type === VIDEO_NODE || (mime?.startsWith("video/") ?? false)
              ? "video"
              : "image";

        byId.set(id, {
          id,
          kind,
          url: typeof attributes.src === "string" ? attributes.src : null,
          mime,
          name,
          width: dimension(attributes.width),
          height: dimension(attributes.height),
          bytes: dimension(attributes.bytes),
          duration: dimension(attributes.duration),
          videoId: typeof attributes.videoId === "string" ? attributes.videoId : null,
          cards: [{ id: card.id, title }],
        });
      });
    }
  }
  return [...byId.values()];
}

/**
 * Every image the document's card bodies reference, keyed by its id.
 *
 * `loroTreeToJson` is the same projection the readable export uses, so this
 * reads the document exactly as a reader would see it and never mutates it.
 */
export function documentAttachments(workspace: WorkspaceDocument): CardAttachment[] {
  const byId = new Map<string, CardAttachment>();
  for (const card of workspace.listCards()) {
    const title = workspace.displayTitle(card.id);
    for (const nodes of [workspace.peekTitle(card.id), workspace.peekContent(card.id)]) {
      visitAttachments(loroTreeToJson(nodes), (attributes) => {
        const id = typeof attributes.id === "string" ? attributes.id : "";
        if (id.length === 0) return;
        const existing = byId.get(id);
        if (existing) {
          if (!existing.cards.some((entry) => entry.id === card.id)) {
            existing.cards.push({ id: card.id, title });
          }
          return;
        }
        const mime = typeof attributes.mime === "string" ? attributes.mime : "";
        const name = typeof attributes.name === "string" ? attributes.name : "";
        byId.set(id, {
          id,
          mime: mime.length > 0 ? mime : null,
          name: name.length > 0 ? name : null,
          width: dimension(attributes.width),
          height: dimension(attributes.height),
          cards: [{ id: card.id, title }],
        });
      });
    }
  }
  return [...byId.values()];
}

/** The ids alone, which is what a byte lookup or a GC pass needs. */
export function documentAttachmentIds(workspace: WorkspaceDocument): string[] {
  return documentAttachments(workspace).map((entry) => entry.id);
}
