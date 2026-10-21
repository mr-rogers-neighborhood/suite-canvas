import type { Board, Card, GraphEdge, Placement } from "@suite/graph";

export interface WorkspaceSnapshot {
  boards: Board[];
  cards: Card[];
  placements: Placement[];
  edges: GraphEdge[];
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
 * Keeps the four collections individually stable. `WorkspaceDocument` hands out
 * the same object for a record until its own fields change, so a peer's edit
 * leaves every other card, placement and edge identical, and the memoised views
 * downstream do not recompute.
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
  if (
    boards === previous.boards &&
    cards === previous.cards &&
    placements === previous.placements &&
    edges === previous.edges
  ) {
    return previous;
  }
  return { boards, cards, placements, edges };
}
