import type { Rect } from "@suite/graph";

/**
 * The box around everything selected.
 *
 * React Flow draws its own outline around selected *nodes*, which is why a selection of cards and
 * frames looked like a selection of cards: a section is not a node, so the outline ignored it and a
 * reader could not tell from the box what they had. This is the union of what the reader actually
 * picked, in flow units, so the box wraps the largest thing in the selection.
 */

export interface SelectionCounts {
  cards: number;
  sections: number;
  links: number;
}

export interface SelectionExtent {
  /** The union of everything selected, or null when nothing is. */
  rect: Rect | null;
  counts: SelectionCounts;
}

/**
 * The union of `rects`.
 *
 * Null for an empty list rather than a degenerate box at the origin: "nothing is selected" and "the
 * selection is a point at 0,0" are different answers, and only one of them should draw.
 */
export function unionOfRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) continue;
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) continue;
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The extent of a selection, from the rects each kind contributes and the counts behind them. */
export function selectionExtent(
  rects: {
    cards: readonly Rect[];
    sections: readonly Rect[];
    links: readonly Rect[];
  },
  counts: SelectionCounts,
): SelectionExtent {
  return {
    rect: unionOfRects([...rects.cards, ...rects.sections, ...rects.links]),
    counts,
  };
}

/**
 * The words beside the box: what is in it, largest thing first.
 *
 * The counts are the whole point. The box says how much space the selection covers; the words say
 * what the reader is about to act on, which is the part a frame's own ring could not answer.
 */
export function describeExtent(counts: SelectionCounts): string {
  const parts = [
    counts.cards > 0 ? `${counts.cards} card${counts.cards === 1 ? "" : "s"}` : null,
    counts.sections > 0 ? `${counts.sections} section${counts.sections === 1 ? "" : "s"}` : null,
    counts.links > 0 ? `${counts.links} link${counts.links === 1 ? "" : "s"}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}
