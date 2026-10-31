import type {
  Card,
  CardType,
  PortableNode,
  WorkspaceDocument,
  WorkspaceMediaItem,
} from "@suite/graph";
import { ATTACHMENT_ID_PATTERN } from "../editor/attachmentNode";

/** Stable id, so the renderer and the library can recognise a media card. */
export const MEDIA_TYPE_ID = "media";

export const MEDIA_TYPE_NAME = "Media";
export const MEDIA_TYPE_PLURAL = "Media";

/**
 * The media type, created on demand.
 *
 * Media used to exist only inside a card body, which made it impossible to place:
 * the library could list a reference but there was nothing to put on a board.
 * A media card is the thing that can be placed, duplicated, linked and used as a
 * field value, and its body holds the one media block, so the reference keeps a
 * single source.
 *
 * Idempotent: a workspace that already has the type keeps whatever the reader
 * renamed it to.
 */
export function ensureMediaType(workspace: WorkspaceDocument): CardType {
  const existing = workspace.getType(MEDIA_TYPE_ID);
  if (existing) return existing;
  return workspace.createType({
    id: MEDIA_TYPE_ID,
    name: MEDIA_TYPE_NAME,
    pluralName: MEDIA_TYPE_PLURAL,
    glyph: "\u{1f5bc}",
  });
}

/**
 * The media block a media card's body holds, read back off a library item.
 *
 * A stored item keeps its id, so the bytes stay where they are and the card
 * references them; a link item keeps its address. Nothing is copied.
 */
export function mediaBodyNode(item: WorkspaceMediaItem): PortableNode {
  if (item.kind === "youtube") {
    return {
      type: "media",
      attrs: compact({
        kind: "youtube",
        videoId: item.videoId,
        title: item.name,
      }),
    };
  }

  const stored = item.mime !== null && item.mime.length > 0 && ATTACHMENT_ID_PATTERN.test(item.id);
  if (stored) {
    return {
      type: "media",
      attrs: compact({
        kind: item.kind === "video" ? "video" : "image",
        id: item.id,
        mime: item.mime,
        name: item.name,
        width: item.width,
        height: item.height,
        bytes: item.bytes,
        duration: item.duration,
      }),
    };
  }

  return {
    type: "media",
    attrs: compact({
      kind: "image",
      src: item.url ?? item.id,
      alt: item.name,
    }),
  };
}

/** Attributes the node does not have are left out rather than written as null. */
function compact(attrs: Record<string, string | number | null>): Record<string, string | number> {
  const kept: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null) kept[key] = value;
  }
  return kept;
}

/**
 * A card of the media type holding one library item.
 *
 * Created unplaced, which is the Inbox: a card on no board is exactly what that
 * list means, and the reader places it from there with the flow they already
 * use. Creating it on the board they happen to be looking at would guess wrong
 * for someone who opened the library to move media somewhere else.
 */
export function createMediaCard(workspace: WorkspaceDocument, item: WorkspaceMediaItem): Card {
  ensureMediaType(workspace);
  const card = workspace.createCard({ typeId: MEDIA_TYPE_ID });
  workspace.setBodyNodes(card.id, [mediaBodyNode(item)]);
  return card;
}
