import {
  type Board,
  type Placement,
  type Section,
  sectionForCard,
  sectionLineage,
  type View,
} from "@suite/graph";
import type { CardWhere, CardWhereSection } from "./CardPanel";

/** The parts of a workspace snapshot that answer "where is this card?". */
export interface CardWhereSnapshot {
  boards: Board[];
  /** A placement on a View names the View: its implicit root plane owns the card. */
  views?: View[] | undefined;
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

  const holders = new Map<string, { id: string; name: string }>();
  for (const view of snapshot.views ?? []) holders.set(view.id, { id: view.id, name: view.name });
  for (const board of snapshot.boards) holders.set(board.id, { id: board.id, name: board.name });
  const ordered = [...placements].sort(
    (a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId),
  );
  const homeId = ordered[0]?.boardId ?? null;
  const entries = ordered
    .flatMap((placement) => {
      const board = holders.get(placement.boardId);
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
