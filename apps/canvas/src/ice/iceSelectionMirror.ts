/**
 * The engine's selection, read as the shell's two lists.
 *
 * ICE reports *entities*; the shell acts on ids, and it keeps cards and links in
 * separate lists (`selectedNodeIds`, `selectedEdgeIds`) because they answer to
 * different menus, different keys and different presence samples. This module is
 * that translation, pure: given the selected entities and the two lookups the
 * surface already keeps, it says which cards and which links are selected.
 *
 * An entity that is neither — a Board mat, a pin, a widget from another kind —
 * is not a selection the shell can act on, so it is dropped rather than guessed
 * at. Duplicates are dropped too: the same card can appear twice on a plane
 * through two placements, and the shell's lists are sets of ids.
 */

import type { Entity } from "@vibecook/ice";

export interface SelectionIds {
  readonly cards: readonly string[];
  readonly edges: readonly string[];
}

export interface MirrorSelectionInput {
  readonly entities: readonly Entity[];
  /** The card a card entity stands for, if it is one. */
  readonly cardOf: (entity: Entity) => string | undefined;
  /** The link an edge entity stands for, if it is one. */
  readonly edgeOf: (entity: Entity) => string | undefined;
}

/** The shell's selection for the engine's, cards first. Never throws, never guesses. */
export function mirrorSelection(input: MirrorSelectionInput): SelectionIds {
  const cards: string[] = [];
  const edges: string[] = [];
  const seenCards = new Set<string>();
  const seenEdges = new Set<string>();
  for (const entity of input.entities) {
    const cardId = input.cardOf(entity);
    if (cardId !== undefined) {
      if (seenCards.has(cardId)) continue;
      seenCards.add(cardId);
      cards.push(cardId);
      continue;
    }
    const edgeId = input.edgeOf(entity);
    if (edgeId === undefined || seenEdges.has(edgeId)) continue;
    seenEdges.add(edgeId);
    edges.push(edgeId);
  }
  return { cards, edges };
}

/**
 * One string for a selection, so a per-frame mirror can compare instead of
 * writing: the separators are control characters a card id cannot contain.
 */
export function selectionKey(selection: SelectionIds): string {
  return `${selection.cards.join("\u001f")}\u001e${selection.edges.join("\u001f")}`;
}

/** Did anything change between two selection keys (the empty key twice is no change)? */
export function selectionChanged(previous: string, next: string): boolean {
  if (previous === next) return false;
  // The first read of an empty selection is not a change: the store is already
  // empty, and a write here would only wake every subscriber.
  return next !== selectionKey({ cards: [], edges: [] }) || previous !== "";
}
