/**
 * Where the line and the outline go.
 *
 * The handbook points from the article to the thing it describes: one line from the row the
 * reader is resting on to the element, and a box around the element so it reads as the subject
 * rather than as another card. This module decides those two shapes and nothing else, so the
 * awkward cases (a target behind the bubble, a target off the screen, a target taller than the
 * window) are tests rather than things noticed while dragging the panel around.
 */
export interface SpotlightBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SpotlightLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface SpotlightGeometry {
  /** The box to outline, or null when there is nothing to outline on this screen. */
  readonly outline: SpotlightBox | null;
  readonly line: SpotlightLine | null;
  /** True when the target is outside the viewport: the line then stops at its edge. */
  readonly offscreen: boolean;
}

export const NO_SPOTLIGHT: SpotlightGeometry = { outline: null, line: null, offscreen: false };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The middle of a box's edge facing another point, which is where a line should meet it. */
function edgePoint(box: SpotlightBox, towardX: number, towardY: number): { x: number; y: number } {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const dx = towardX - centreX;
  const dy = towardY - centreY;
  // Leaving through the side with the larger share of the direction keeps the line short and
  // stops it crossing the box it is pointing at.
  if (Math.abs(dx) * box.height > Math.abs(dy) * box.width) {
    return { x: dx > 0 ? box.x + box.width : box.x, y: centreY };
  }
  return { x: centreX, y: dy > 0 ? box.y + box.height : box.y };
}

/**
 * The geometry for one hover, or nothing when either end is missing.
 *
 * The target is clamped to the viewport rather than dragged into view: a hover never moves the
 * camera, so an element half off the screen is outlined by the half the reader can see and the
 * line points at where it is.
 */
export function spotlightGeometry(
  anchor: SpotlightBox | null,
  target: SpotlightBox | null,
  viewport: SpotlightBox,
): SpotlightGeometry {
  if (!anchor || !target) return NO_SPOTLIGHT;

  // A row inside the thing it describes has nothing to point at: the line would be a stub that
  // starts and ends on the same box, which is what an article about the panel itself produces.
  if (
    anchor.x >= target.x &&
    anchor.y >= target.y &&
    anchor.x + anchor.width <= target.x + target.width &&
    anchor.y + anchor.height <= target.y + target.height
  ) {
    return { outline: target, line: null, offscreen: false };
  }

  const clamped: SpotlightBox = {
    x: clamp(target.x, viewport.x, viewport.x + viewport.width),
    y: clamp(target.y, viewport.y, viewport.y + viewport.height),
    width: Math.max(0, Math.min(target.width, viewport.width)),
    height: Math.max(0, Math.min(target.height, viewport.height)),
  };
  const offscreen =
    target.x + target.width < viewport.x ||
    target.y + target.height < viewport.y ||
    target.x > viewport.x + viewport.width ||
    target.y > viewport.y + viewport.height;

  if (offscreen) {
    // A line to an edge that a reader cannot follow anywhere is worse than a short line that
    // ends at the edge, so the endpoint is pulled inside and the caller says "off screen".
    const x2 = clamp(
      target.x + target.width / 2,
      viewport.x + 12,
      viewport.x + viewport.width - 12,
    );
    const y2 = clamp(
      target.y + target.height / 2,
      viewport.y + 12,
      viewport.y + viewport.height - 12,
    );
    const from = edgePoint(anchor, x2, y2);
    return { outline: null, line: { x1: from.x, y1: from.y, x2, y2 }, offscreen: true };
  }

  const from = edgePoint(anchor, clamped.x + clamped.width / 2, clamped.y + clamped.height / 2);
  const to = edgePoint(clamped, anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
  return {
    outline: clamped,
    line: { x1: from.x, y1: from.y, x2: to.x, y2: to.y },
    offscreen: false,
  };
}

/** A DOM rect in the shape the geometry takes. */
export function boxOf(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): SpotlightBox {
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}
