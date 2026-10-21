import type { Board, Placement } from "@suite/graph";

/** One board a card appears on, for the card footer and the inspector. */
export interface CardReference {
  boardId: string;
  boardName: string;
  isHome: boolean;
  isCurrent: boolean;
}

/**
 * Groups every placement by card, home first. The board computes this once per
 * placement change so a card node never has to subscribe to the whole graph.
 */
export function cardReferences(
  boards: Board[],
  placements: Placement[],
  currentBoardId: string | null,
): Map<string, CardReference[]> {
  const boardsById = new Map(boards.map((board) => [board.id, board]));
  const byCard = new Map<string, Placement[]>();

  for (const placement of placements) {
    const list = byCard.get(placement.cardId) ?? [];
    list.push(placement);
    byCard.set(placement.cardId, list);
  }

  const result = new Map<string, CardReference[]>();
  for (const [cardId, entries] of byCard) {
    entries.sort((a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId));
    const home = entries[0]?.boardId ?? null;
    result.set(
      cardId,
      entries
        .flatMap((entry) => {
          const board = boardsById.get(entry.boardId);
          if (!board) return [];
          return [
            {
              boardId: entry.boardId,
              boardName: board.name,
              isHome: entry.boardId === home,
              isCurrent: entry.boardId === currentBoardId,
            },
          ];
        })
        .sort(
          (a, b) => Number(b.isHome) - Number(a.isHome) || a.boardName.localeCompare(b.boardName),
        ),
    );
  }
  return result;
}
