import type {
  Board,
  Card,
  CardType,
  GraphEdge,
  Placement,
  Section,
  Tag,
  WorkspaceAction,
  WorkspaceChange,
} from "@suite/graph";
import { DEFAULT_TYPE_ID, placementKey, sameTargets } from "@suite/graph";
import type { WorkspaceSnapshot } from "./snapshotMerge";

/**
 * Narrows the loosely typed observe payload. The emitter always pairs a section
 * with its record type; these guards just make that contract explicit.
 */
function boardValue(value: WorkspaceChange["value"]): Board | null {
  return value !== null && "name" in value && "updatedAt" in value && !("glyph" in value)
    ? value
    : null;
}

function cardValue(value: WorkspaceChange["value"]): Card | null {
  // A section now carries connectors too, so cards are identified by the
  // properties only they have rather than by their connector list.
  return value !== null && "primaryTypeId" in value && "properties" in value ? value : null;
}

function placementValue(value: WorkspaceChange["value"]): Placement | null {
  return value !== null && "cardId" in value && "z" in value ? value : null;
}

function edgeValue(value: WorkspaceChange["value"]): GraphEdge | null {
  return value !== null && "target" in value ? value : null;
}

function typeValue(value: WorkspaceChange["value"]): CardType | null {
  return value !== null && "glyph" in value && "fields" in value ? value : null;
}

function tagValue(value: WorkspaceChange["value"]): Tag | null {
  return value !== null && "name" in value && "createdAt" in value && !("updatedAt" in value)
    ? value
    : null;
}

function sectionValue(value: WorkspaceChange["value"]): Section | null {
  return value !== null && "title" in value && "width" in value ? value : null;
}

function compareBoards(a: Board, b: Board): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function compareTypes(a: CardType, b: CardType): number {
  return (
    Number(b.id === DEFAULT_TYPE_ID) - Number(a.id === DEFAULT_TYPE_ID) ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

function compareTags(a: Tag, b: Tag): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function compareSections(a: Section, b: Section): number {
  return a.z - b.z || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Insertion point in a list already sorted like the matching `list*` read. */
function insertionIndex<T>(items: T[], value: T, compare: (a: T, b: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const candidate = items[middle];
    if (candidate !== undefined && compare(candidate, value) > 0) high = middle;
    else low = middle + 1;
  }
  return low;
}

function without<T>(items: T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

/**
 * Sorted collections (boards, types, tags) put a new or re-dated record back in
 * sort order instead of at the end.
 */
function changeSorted<T>(
  items: T[],
  action: WorkspaceAction,
  key: string,
  value: T | null,
  idOf: (item: T) => string,
  compare: (a: T, b: T) => number,
): T[] {
  const index = items.findIndex((item) => idOf(item) === key);
  if (action === "delete" || value === null) {
    return index === -1 ? items : without(items, index);
  }

  const rest = index === -1 ? items : without(items, index);
  const insertAt = insertionIndex(rest, value, compare);
  if (index === insertAt && items[index] === value) return items;

  const next = rest === items ? items.slice() : rest;
  next.splice(insertAt, 0, value);
  return next;
}

/**
 * Keyed records keep their existing order: an update replaces the record in
 * place and an add appends, matching the document's key iteration.
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
      const boards = changeSorted(
        snapshot.boards,
        change.action,
        change.key,
        boardValue(change.value),
        (board) => board.id,
        compareBoards,
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
    case "types": {
      const types = changeSorted(
        snapshot.types,
        change.action,
        change.key,
        typeValue(change.value),
        (type) => type.id,
        compareTypes,
      );
      return types === snapshot.types ? snapshot : { ...snapshot, types };
    }
    case "tags": {
      const tags = changeSorted(
        snapshot.tags,
        change.action,
        change.key,
        tagValue(change.value),
        (tag) => tag.id,
        compareTags,
      );
      return tags === snapshot.tags ? snapshot : { ...snapshot, tags };
    }
    case "sections": {
      const sections = changeSorted(
        snapshot.sections,
        change.action,
        change.key,
        sectionValue(change.value),
        (section) => section.id,
        compareSections,
      );
      return sections === snapshot.sections ? snapshot : { ...snapshot, sections };
    }
    case "references": {
      const targets = Array.isArray(change.value) ? [...change.value].sort() : [];
      const existing = snapshot.references[change.key];
      if (targets.length === 0) {
        if (existing === undefined) return snapshot;
        const references = { ...snapshot.references };
        delete references[change.key];
        return { ...snapshot, references };
      }
      if (existing !== undefined && sameTargets(existing, targets)) return snapshot;
      return { ...snapshot, references: { ...snapshot.references, [change.key]: targets } };
    }
  }
}
