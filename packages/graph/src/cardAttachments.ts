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

/** The editor's image node. A URL-only `image` node has no bytes and is skipped. */
const ATTACHMENT_NODE = "attachment";

function dimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function visitAttachments(
  nodes: readonly PortableNode[],
  visit: (attributes: Record<string, unknown>) => void,
): void {
  for (const node of nodes) {
    if (node.type === ATTACHMENT_NODE) visit(node.attrs ?? {});
    if (node.content) visitAttachments(node.content, visit);
  }
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
