import { PORTAL_BOARD_FIELD_ID } from "@suite/graph";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { BOARD_TYPE_FACET, type LibraryItem } from "./libraryTypes";

/**
 * Every board as a library row.
 *
 * A board has no type, no fields and no placement of its own, but in the library
 * it behaves exactly like a card: it is searched, filtered, selected and dragged
 * the same way. So it becomes a `LibraryItem` whose type is `board`, and its
 * "location" is the board the portal that opens it sits on — which is what makes
 * a board show up when the list is scoped to the board you are reading, and
 * absent when nothing points at it.
 *
 * `openedBy` is the set of boards holding a portal to this one. Empty means the
 * board is reachable only from the library (or by naming it as last-used), which
 * is exactly what the inbox is for.
 */
export function toBoardItems(
  snapshot: WorkspaceSnapshot,
): Array<LibraryItem & { cardCount: number; updatedAt: number }> {
  const live = new Set(snapshot.cards.filter((card) => !card.deletedAt).map((card) => card.id));
  const names = new Map(snapshot.boards.map((board) => [board.id, board.name]));

  const placedOn = new Map<string, number>();
  const portalsTo = new Map<string, Set<string>>();
  const cardBoard = new Map<string, string>();
  for (const placement of snapshot.placements) {
    if (!live.has(placement.cardId)) continue;
    placedOn.set(placement.boardId, (placedOn.get(placement.boardId) ?? 0) + 1);
    cardBoard.set(placement.cardId, placement.boardId);
  }
  for (const card of snapshot.cards) {
    if (card.deletedAt) continue;
    const target = card.properties[PORTAL_BOARD_FIELD_ID];
    if (typeof target !== "string" || target.length === 0) continue;
    const from = cardBoard.get(card.id);
    if (from === undefined) continue;
    const set = portalsTo.get(target) ?? new Set<string>();
    set.add(from);
    portalsTo.set(target, set);
  }

  return snapshot.boards.map((board) => ({
    id: board.id,
    title: board.name,
    kind: "board" as const,
    boards: [...(portalsTo.get(board.id) ?? [])].flatMap((id) => {
      const name = names.get(id);
      return name === undefined ? [] : [{ id, name }];
    }),
    typeIds: [BOARD_TYPE_FACET],
    tagIds: board.tags,
    sectionIds: [],
    properties: {},
    cardCount: placedOn.get(board.id) ?? 0,
    updatedAt: board.updatedAt,
  }));
}

/** Boards nothing points at: the inbox's board half. */
export function unopenedBoards(items: readonly LibraryItem[]): LibraryItem[] {
  return items.filter((item) => item.boards.length === 0);
}

/** Whether any portal anywhere names this board. */
export function openedByPortal(snapshot: WorkspaceSnapshot, boardId: string): boolean {
  return snapshot.cards.some(
    (card) => !card.deletedAt && card.properties[PORTAL_BOARD_FIELD_ID] === boardId,
  );
}
