import type { Board, Card, CardType, GraphEdge, Placement, Section, Tag } from "@suite/graph";

export interface WorkspaceSnapshot {
  boards: Board[];
  cards: Card[];
  placements: Placement[];
  edges: GraphEdge[];
  types: CardType[];
  tags: Tag[];
  sections: Section[];
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
  const cards = reuseArray(previous.cards, next.cards);
  const placements = reuseArray(previous.placements, next.placements);
  const edges = reuseArray(previous.edges, next.edges);
  const types = reuseArray(previous.types, next.types);
  const tags = reuseArray(previous.tags, next.tags);
  const sections = reuseArray(previous.sections, next.sections);
  if (
    boards === previous.boards &&
    cards === previous.cards &&
    placements === previous.placements &&
    edges === previous.edges &&
    types === previous.types &&
    tags === previous.tags &&
    sections === previous.sections
  ) {
    return previous;
  }
  return { boards, cards, placements, edges, types, tags, sections };
}
