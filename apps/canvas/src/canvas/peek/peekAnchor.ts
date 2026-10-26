import type { PeekAnchor } from "./usePeek";

/** The gap between a trigger and the peek beside it, in pixels. */
export const PEEK_OFFSET = 8;

/**
 * Where a peek sits for a trigger: just to the right of its box, level with its top.
 *
 * Kept next to the peek rather than in each surface, so every trigger puts the peek in
 * the same place. An element that is not laid out (jsdom, a hidden row) yields null and
 * the surface falls back to its own position.
 */
export function anchorOf(element: Element | null | undefined): PeekAnchor | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && rect.right === 0 && rect.top === 0) return null;
  return { x: rect.right + PEEK_OFFSET, y: rect.top };
}
