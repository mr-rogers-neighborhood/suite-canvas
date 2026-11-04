/**
 * What a drag of a *mixed* selection moves.
 *
 * React Flow drags nodes, so a selection of cards and a section moves only the cards and the frame
 * stays behind — the group the reader picked splits in two. A section is not a node, so its movement
 * has to be derived: the frame, the frames nested in it and the cards inside it travel by the same
 * delta, and a card React Flow is already carrying is left out, or it would be written twice and land
 * at double the distance.
 *
 * Membership and lineage come from `@suite/graph`, so a group drag and a header drag of the same
 * section move exactly the same things.
 */

import { type Placement, type Section, sectionMovePlan } from "@suite/graph";

export interface SelectionDragInput {
  readonly sections: readonly Section[];
  readonly placements: readonly Placement[];
  /** The frames selected alongside the cards. A nested pair contributes one lineage, deduped. */
  readonly selectedSectionIds: readonly string[];
  /** Cards React Flow is already moving: their positions are committed from the nodes. */
  readonly draggedNodeIds: readonly string[];
  readonly delta: { readonly x: number; readonly y: number };
}

export interface SelectionDragPlan {
  readonly sections: { id: string; x: number; y: number }[];
  readonly placements: { boardId: string; cardId: string; x: number; y: number }[];
}

const EMPTY: SelectionDragPlan = { sections: [], placements: [] };

/**
 * The section writes and the extra placement writes a group drag needs.
 *
 * Empty when there is nothing to add: no frame selected, a frame that is not on this board, or a
 * gesture that ended where it started. The caller then commits its cards alone, which is the ordinary
 * drop.
 */
export function selectionDragPlan(input: SelectionDragInput): SelectionDragPlan {
  const { sections, placements, selectedSectionIds, draggedNodeIds, delta } = input;
  if (selectedSectionIds.length === 0) return EMPTY;
  if (delta.x === 0 && delta.y === 0) return EMPTY;

  // Each root brings its own lineage; an outer frame already contains the inner one, so the sets are
  // merged by id rather than concatenated and nothing is written twice.
  const movedSections = new Map<string, { id: string; x: number; y: number }>();
  const movedPlacements = new Map<
    string,
    { boardId: string; cardId: string; x: number; y: number }
  >();
  const carried = new Set(draggedNodeIds);

  for (const root of selectedSectionIds) {
    if (!sections.some((section) => section.id === root)) continue;
    const lineage = sectionMovePlan(root, [...sections], [...placements]);
    for (const section of lineage.sections) {
      movedSections.set(section.id, {
        id: section.id,
        x: section.x + delta.x,
        y: section.y + delta.y,
      });
    }
    for (const placement of lineage.placements) {
      if (carried.has(placement.cardId)) continue;
      movedPlacements.set(placement.cardId, {
        boardId: placement.boardId,
        cardId: placement.cardId,
        x: placement.x + delta.x,
        y: placement.y + delta.y,
      });
    }
  }

  if (movedSections.size === 0) return EMPTY;
  return { sections: [...movedSections.values()], placements: [...movedPlacements.values()] };
}

/**
 * The translation a drop made, read from the first card whose stored position is known.
 *
 * React Flow reports absolute positions, and a group drag is one translation, so any card that moved
 * answers for the whole gesture. A card with no stored placement (a drop of something just created)
 * cannot answer and is skipped.
 */
export function dragDelta(
  moves: readonly { cardId: string; x: number; y: number }[],
  placements: readonly Placement[],
): { x: number; y: number } {
  for (const move of moves) {
    const stored = placements.find((placement) => placement.cardId === move.cardId);
    if (stored) return { x: move.x - stored.x, y: move.y - stored.y };
  }
  return { x: 0, y: 0 };
}

/**
 * One section list from a move and a grow of the same frame.
 *
 * A frame can need both in one drop — it travels with the group and a card that landed outside its
 * new edge has to widen it — and two entries for one id would make the last write win, dropping the
 * other half of the change.
 */
export function mergeSectionWrites(
  moved: readonly { id: string; x: number; y: number }[],
  grown: readonly { id: string; x: number; y: number; width?: number; height?: number }[],
): { id: string; x: number; y: number; width?: number; height?: number }[] {
  const merged = new Map<
    string,
    { id: string; x: number; y: number; width?: number; height?: number }
  >();
  for (const write of grown) merged.set(write.id, { ...write });
  for (const write of moved) {
    const existing = merged.get(write.id);
    merged.set(
      write.id,
      existing ? { ...existing, x: write.x, y: write.y } : { id: write.id, x: write.x, y: write.y },
    );
  }
  return [...merged.values()];
}
