import { PORTAL_BOARD_FIELD_ID } from "@suite/graph";
import type { LibraryBoard, LibraryItem } from "./libraryTypes";

/**
 * Board ids something opens: the workspace's entry board and every board a
 * portal names.
 *
 * The entry board is the named home, or the first board, because that is what
 * the shell falls back to when nothing else is open or requested. Read from the
 * list's own props on every render, never stored: a portal repointed a moment
 * ago has to move the hint with it.
 */
export function openedBoardIds(
  boards: readonly LibraryBoard[],
  cards: readonly LibraryItem[],
  homeBoardId: string | null,
): Set<string> {
  const ids = new Set<string>();
  const entry = homeBoardId ?? boards[0]?.id;
  if (entry !== undefined) ids.add(entry);

  for (const card of cards) {
    const target = card.properties[PORTAL_BOARD_FIELD_ID];
    // A portal is a card whose board property names a board; any other value is
    // not a doorway and opens nothing.
    if (typeof target === "string" && target.trim().length > 0) ids.add(target);
  }
  return ids;
}
