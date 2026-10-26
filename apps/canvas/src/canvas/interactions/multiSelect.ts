import type { LayerAction, PlacementMoveInput, Rect } from "@suite/graph";

/**
 * The part of a React Flow node a drop needs. Kept structural so the helpers
 * stay pure and testable without a renderer.
 */
export interface DraggedNode {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number | undefined; height?: number | undefined } | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/** Card box assumed until React Flow has measured it, matching the canvas default. */
/**
 * Default card box in flow units. Deliberately large and close to square: a
 * card is a place to read and write, not a label, and a squarer box keeps the
 * title and the first lines of the body visible at the default zoom.
 */
export const DEFAULT_CARD_WIDTH = 288;
export const DEFAULT_CARD_HEIGHT = 240;

export interface SelectionSummary {
  /** Distinct card ids, in the order given. */
  ids: string[];
  count: number;
  /** Whether the selection menu applies instead of the single-card menu. */
  multiple: boolean;
  /** `1 card` / `3 cards`, for menu labels. */
  noun: string;
}

/** Label and menu-enablement data for a set of selected cards. */
export function selectionSummary(ids: readonly string[]): SelectionSummary {
  const unique = [...new Set(ids)];
  const count = unique.length;
  return {
    ids: unique,
    count,
    multiple: count > 1,
    noun: `${count} card${count === 1 ? "" : "s"}`,
  };
}

/**
 * The selected cards in board paint order (bottom to top). Ids that are not on
 * the board are dropped, so a stale selection cannot drive a layer write.
 */
export function orderedSelection(
  boardOrder: readonly string[],
  selected: readonly string[],
): string[] {
  const wanted = new Set(selected);
  return boardOrder.filter((id) => wanted.has(id));
}

/**
 * The order to apply a bulk layer action in, given the selection in board paint
 * order (bottom to top).
 *
 * `moveLayer` resolves each card's target from the *current* list, so cards
 * that take part in the same gesture must be moved in an order where the
 * already-moved ones do not get in the way:
 *
 * - `front` — bottom to top: the last card applied lands on top, so the group
 *   keeps its relative order.
 * - `back` — top to bottom: the mirror image; the last card applied lands on
 *   the bottom with the rest stacked above it in order.
 * - `forward` — top to bottom: each card steps above a neighbour that has
 *   already moved up, so none is skipped over.
 * - `backward` — bottom to top: the mirror of `forward`.
 */
export function layerActions(orderedIds: readonly string[], action: LayerAction): string[] {
  const ids = [...orderedIds];
  return action === "front" || action === "backward" ? ids : ids.reverse();
}

/** React Flow nodes as the placement moves one multi-drag commits. */
export function dragMoves(nodes: readonly DraggedNode[]): PlacementMoveInput[] {
  return nodes.map((node) => ({ cardId: node.id, x: node.position.x, y: node.position.y }));
}

/** React Flow nodes as the rects a drop uses to expand the sections they land in. */
export function dragRects(nodes: readonly DraggedNode[]): Rect[] {
  return nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? node.width ?? DEFAULT_CARD_WIDTH,
    height: node.measured?.height ?? node.height ?? DEFAULT_CARD_HEIGHT,
  }));
}
