import type { DraggingState } from "../collab/presence";

export interface GroupRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Cards in the gesture, so the chip can say how many are moving. */
  count: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

/** Card size assumed until React Flow has measured it. */
const FALLBACK_SIZE: Size2D = { width: 224, height: 160 };

/**
 * The live bounding box of a peer's multi-card drag. The leader streams only
 * the anchor, so every other member sits at its stored placement plus the
 * anchor's delta — the same derivation the canvas uses to move the cards.
 * Returns null for a single-card drag, which carries its own label.
 */
export function peerDragGroup(
  dragging: DraggingState,
  placements: Map<string, Point2D>,
  sizes: Map<string, Size2D>,
): GroupRect | null {
  const ids = dragging.nodeIds ?? [];
  if (ids.length < 2) return null;

  const anchor = placements.get(dragging.nodeId);
  if (!anchor) return null;
  const dx = dragging.position.x - anchor.x;
  const dy = dragging.position.y - anchor.y;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const id of ids) {
    const placement = placements.get(id);
    if (!placement) continue;
    const size = sizes.get(id) ?? FALLBACK_SIZE;
    const x = placement.x + dx;
    const y = placement.y + dy;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.width);
    maxY = Math.max(maxY, y + size.height);
    count += 1;
  }

  if (count === 0) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, count };
}
