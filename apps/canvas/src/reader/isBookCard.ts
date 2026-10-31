import type { WorkspaceDocument } from "@suite/graph";
import { MEDIA_NODE_NAME } from "../editor/mediaNode";

/**
 * Whether a card holds a book.
 *
 * Read from the body rather than from a type: a book is a `media` block with `kind: "epub"`, and a card's type is
 * the reader's to change. The same rule `isWhiteboardCard` follows, one block along.
 */
export function isBookCard(workspace: WorkspaceDocument | null, cardId: string): boolean {
  if (workspace === null) return false;
  return workspace
    .bodyNodes(cardId)
    .some((node) => node.type === MEDIA_NODE_NAME && node.attrs?.kind === "epub");
}
