import type { Target } from "@suite/graph";
import { regionSelector } from "../handbook/regions";

/**
 * The element on screen that stands for a target, or null when nothing does.
 *
 * Two surfaces measure a target: the tour overlay, which spotlights it, and the handbook, which
 * points at it. They have to agree about what "the thing" is, so the answer lives here rather than
 * twice. A card carries `data-node-id`, a section `data-testid="section-region-<id>"`, a link
 * `data-id`, and a region of the shell `data-handbook-region`; a board is the surface itself and
 * has nothing to outline.
 *
 * This reads the DOM, so it is the imperative edge: the geometry the callers do with the result is
 * theirs, and no part of this decides what to draw.
 */
export function targetElement(target: Target | null): Element | null {
  if (!target) return null;
  const id = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(target.id) : target.id;
  switch (target.kind) {
    case "card":
      return document.querySelector(`[data-node-id="${id}"]`);
    case "section":
      return document.querySelector(`[data-testid="section-region-${id}"]`);
    case "link":
      return document.querySelector(`[data-id="${id}"]`);
    case "ui":
      return document.querySelector(regionSelector(target.id));
    case "board":
      // A board is the surface itself; there is nothing to outline on it.
      return null;
  }
}
