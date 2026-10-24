import type { Board, Card, CardType, GraphEdge, Placement, Section, Tag, View } from "@suite/graph";
import { sameTargets } from "@suite/graph";

export interface WorkspaceSnapshot {
  /** The Board tree: every container, on every View (ADR-0039). */
  boards: Board[];
  /** Cameras. A View holds no content; the same Boards show in each one. */
  views: View[];
  cards: Card[];
  placements: Placement[];
  edges: GraphEdge[];
  types: CardType[];
  tags: Tag[];
  /**
   * The Board tree read as the legacy frame shape: one Section per Board,
   * flattened into the View's plane. Derived, never stored (ADR-0039).
   */
  sections: Section[];
  /** `fromCardId` → mentioned ids. Derived; identity-stable per card. */
  references: Record<string, string[]>;
}

/** Reuses the previous array when every element is still the same object. */
export function reuseArray<T>(previous: T[] | undefined, next: T[]): T[] {
  if (!previous || previous.length !== next.length) return next;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] !== next[index]) return next;
  }
  return previous;
}

/**
 * Reuses the previous object when every card's target list is unchanged, and
 * reuses each unchanged card's array so a card only sees new references when
 * its own list moved.
 */
export function reuseReferences(
  previous: Record<string, string[]> | undefined,
  next: Record<string, string[]>,
): Record<string, string[]> {
  if (!previous) return next;
  let same = Object.keys(previous).length === Object.keys(next).length;
  const merged: Record<string, string[]> = {};
  for (const [cardId, targets] of Object.entries(next)) {
    const before = previous[cardId];
    if (before !== undefined && sameTargets(before, targets)) merged[cardId] = before;
    else {
      merged[cardId] = targets;
      same = false;
    }
  }
  for (const cardId of Object.keys(previous)) {
    if (next[cardId] === undefined) same = false;
  }
  return same ? previous : merged;
}

/**
 * Keeps every collection individually stable. `WorkspaceDocument` hands out the
 * same object for a record until its own fields change, so a peer's edit leaves
 * every other card, placement, edge, type and tag identical, and the memoised
 * views downstream do not recompute.
 */
export function mergeSnapshots(
  previous: WorkspaceSnapshot | undefined,
  next: WorkspaceSnapshot,
): WorkspaceSnapshot {
  if (!previous) return next;
  const boards = reuseArray(previous.boards, next.boards);
  const views = reuseArray(previous.views, next.views);
  const cards = reuseArray(previous.cards, next.cards);
  const placements = reuseArray(previous.placements, next.placements);
  const edges = reuseArray(previous.edges, next.edges);
  const types = reuseArray(previous.types, next.types);
  const tags = reuseArray(previous.tags, next.tags);
  const sections = reuseArray(previous.sections, next.sections);
  const references = reuseReferences(previous.references, next.references);
  if (
    boards === previous.boards &&
    views === previous.views &&
    cards === previous.cards &&
    placements === previous.placements &&
    edges === previous.edges &&
    types === previous.types &&
    tags === previous.tags &&
    sections === previous.sections &&
    references === previous.references
  ) {
    return previous;
  }
  return { boards, views, cards, placements, edges, types, tags, sections, references };
}
