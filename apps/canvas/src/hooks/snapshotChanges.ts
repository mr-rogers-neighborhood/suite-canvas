import type {
  Board,
  Card,
  GraphEdge,
  Placement,
  WorkspaceAction,
  WorkspaceChange,
} from "@suite/graph";
import { placementKey } from "@suite/graph";
import type { WorkspaceSnapshot } from "./snapshotMerge";

/**
 * Narrows the loosely typed observe payload. The emitter always pairs a section
 * with its record type; these guards just make that contract explicit.
 */
function boardValue(value: WorkspaceChange["value"]): Board | null {
  return value !== null && "name" in value ? value : null;
}

function cardValue(value: WorkspaceChange["value"]): Card | null {
  return value !== null && "connectors" in value ? value : null;
}

function placementValue(value: WorkspaceChange["value"]): Placement | null {
  return value !== null && "z" in value ? value : null;
}

function edgeValue(value: WorkspaceChange["value"]): GraphEdge | null {
  return value !== null && "target" in value ? value : null;
}

function compareBoards(a: Board, b: Board): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Insertion point in a list already sorted like `WorkspaceDocument.listBoards`. */
function boardInsertionIndex(boards: Board[], board: Board): number {
  let low = 0;
  let high = boards.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const candidate = boards[middle];
    if (!candidate || compareBoards(candidate, board) > 0) high = middle;
    else low = middle + 1;
  }
  return low;
}

function without<T>(items: T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * Boards are sorted views, so a new or re-dated board goes back in sort order
 * instead of at the end.
 */
function changeBoards(
  boards: Board[],
  action: WorkspaceAction,
  key: string,
  value: Board | null,
): Board[] {
  const index = boards.findIndex((board) => board.id === key);
  if (action === "delete" || value === null) {
    return index === -1 ? boards : without(boards, index);
  }

  const rest = index === -1 ? boards : without(boards, index);
  const insertAt = boardInsertionIndex(rest, value);
  if (index === insertAt && boards[index] === value) return boards;

  const next = rest === boards ? boards.slice() : rest;
  next.splice(insertAt, 0, value);
  return next;
}

/**
 * Keyed records keep their existing order: an update replaces the record in
 * place and an add appends, matching Y.Map key iteration closely enough for the
 * current consumers.
 */
function changeKeyed<T>(items: T[], action: WorkspaceAction, index: number, value: T | null): T[] {
  if (action === "delete" || value === null) {
    return index === -1 ? items : without(items, index);
  }
  if (index === -1) return [...items, value];
  if (items[index] === value) return items;

  const next = items.slice();
  next[index] = value;
  return next;
}

/**
 * Folds one `WorkspaceDocument.observe` record into a snapshot. Collections
 * that did not change keep their identity, so memoised board views only
 * recompute for the section that actually moved.
 */
export function applyWorkspaceChange(
  snapshot: WorkspaceSnapshot,
  change: WorkspaceChange,
): WorkspaceSnapshot {
  switch (change.section) {
    case "boards": {
      const boards = changeBoards(
        snapshot.boards,
        change.action,
        change.key,
        boardValue(change.value),
      );
      return boards === snapshot.boards ? snapshot : { ...snapshot, boards };
    }
    case "cards": {
      const cards = changeKeyed(
        snapshot.cards,
        change.action,
        snapshot.cards.findIndex((card) => card.id === change.key),
        cardValue(change.value),
      );
      return cards === snapshot.cards ? snapshot : { ...snapshot, cards };
    }
    case "placements": {
      const placements = changeKeyed(
        snapshot.placements,
        change.action,
        snapshot.placements.findIndex(
          (placement) => placementKey(placement.boardId, placement.cardId) === change.key,
        ),
        placementValue(change.value),
      );
      return placements === snapshot.placements ? snapshot : { ...snapshot, placements };
    }
    case "edges": {
      const edges = changeKeyed(
        snapshot.edges,
        change.action,
        snapshot.edges.findIndex((edge) => edge.id === change.key),
        edgeValue(change.value),
      );
      return edges === snapshot.edges ? snapshot : { ...snapshot, edges };
    }
  }
}
