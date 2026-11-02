import { useMemo } from "react";
import { MEDIA_NODE_NAME } from "../editor/mediaNode";
import { useCanvasStore } from "../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { type ReadingPosition, useBookStore } from "./bookStore";

/**
 * The books this reader was last in.
 *
 * A reading position is stored per attachment, and what a reader recognises is the card: "the book I was reading" is a
 * card on a board, not an attachment id. So the two are joined here, once, and a book whose card has been deleted
 * simply drops out rather than becoming a row that opens nothing.
 */
export interface BookInProgress {
  readonly cardId: string;
  readonly attachmentId: string;
  readonly name: string;
  readonly position: ReadingPosition;
}

/** How many books "continue reading" is worth showing. Two is a choice; a list of them is the library it already is. */
export const CONTINUE_READING_LIMIT = 2;

interface BookCard {
  readonly cardId: string;
  readonly name: string;
}

export function useContinueReading(limit = CONTINUE_READING_LIMIT): BookInProgress[] {
  const workspace = useCanvasStore((state) => state.workspace);
  const positions = useBookStore((state) => state.positions);
  const cards = useWorkspaceSnapshot().cards;

  return useMemo(() => {
    if (workspace === null) return [];
    const books = new Map<string, BookCard>();
    for (const card of cards) {
      for (const node of workspace.bodyNodes(card.id)) {
        if (node.type !== MEDIA_NODE_NAME || node.attrs?.kind !== "epub") continue;
        const id = node.attrs.id;
        // The block's own name is the book's title; the card's is whatever the reader called the card.
        if (typeof id === "string" && id.length > 0) {
          books.set(id, {
            cardId: card.id,
            name:
              typeof node.attrs?.name === "string"
                ? node.attrs.name
                : workspace.displayTitle(card.id),
          });
        }
        break;
      }
    }
    return Object.entries(positions)
      .flatMap(([key, position]) => {
        // A stored key is `workspace/attachment`, so the attachment is its last segment.
        const attachmentId = key.slice(key.lastIndexOf("/") + 1);
        const book = books.get(attachmentId);
        if (book === undefined) return [];
        return [{ cardId: book.cardId, attachmentId, name: book.name, position }];
      })
      .sort((a, b) => b.position.at - a.position.at)
      .slice(0, limit);
  }, [workspace, positions, cards, limit]);
}
