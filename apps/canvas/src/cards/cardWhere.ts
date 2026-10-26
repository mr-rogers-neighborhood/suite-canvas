import {
  type Board,
  type Placement,
  type Section,
  sectionForCard,
  sectionLineage,
} from "@suite/graph";
export interface CardWhereSection {
  id: string;
  name: string;
  color?: string;
}

/** One board a card is placed on, with its section path on that board. */
export interface CardWhereEntry {
  boardId: string;
  boardName: string;
  isCurrent: boolean;
  isHome: boolean;
  sectionPath: CardWhereSection[];
}

/**
 * "Where is this card?" — derived from placements plus section geometry, so a
 * section rename or move updates the panel without any extra writes.
 */
export interface CardWhere {
  unplaced: boolean;
  entries: CardWhereEntry[];
}

/** The parts of a workspace snapshot that answer "where is this card?". */
export interface CardWhereSnapshot {
  boards: Board[];
  placements: Placement[];
  sections: Section[];
}

/**
 * The chain of sections containing the card's section, outermost first.
 * Membership is derived from geometry, so renaming or moving a section updates
 * every breadcrumb without an extra write.
 */
export function sectionPath(match: Section, sections: Section[]): CardWhereSection[] {
  return (
    sections
      .filter((candidate) =>
        sectionLineage(candidate.id, sections).some((entry) => entry.id === match.id),
      )
      // Largest first: a breadcrumb reads outermost to innermost.
      .sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id))
      .map((section) => ({
        id: section.id,
        name: section.title || "Untitled section",
        ...(section.color ? { color: `var(--section-${section.color})` } : {}),
      }))
  );
}

/**
 * Where a card lives: the current board first (with its section breadcrumb),
 * then every other board it is placed on. Unplaced cards say so.
 */
export function cardWhere(
  snapshot: CardWhereSnapshot,
  cardId: string,
  activeBoardId: string | null,
): CardWhere {
  const placements = snapshot.placements.filter((entry) => entry.cardId === cardId);
  if (placements.length === 0) return { unplaced: true, entries: [] };

  const boardsById = new Map(snapshot.boards.map((board) => [board.id, board]));
  const ordered = [...placements].sort(
    (a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId),
  );
  const homeId = ordered[0]?.boardId ?? null;
  const entries = ordered
    .flatMap((placement) => {
      const board = boardsById.get(placement.boardId);
      if (!board) return [];
      const sections = snapshot.sections.filter((entry) => entry.boardId === board.id);
      const match = sectionForCard(placement, sections);
      return [
        {
          boardId: board.id,
          boardName: board.name,
          isCurrent: board.id === activeBoardId,
          isHome: board.id === homeId,
          sectionPath: match ? sectionPath(match, sections) : [],
        },
      ];
    })
    .sort((a, b) => Number(b.isHome) - Number(a.isHome) || a.boardName.localeCompare(b.boardName));

  return { unplaced: false, entries };
}
