/**
 * The camera's usable range and the content breakpoints that go with it
 * ([ADR-0051](../../../../docs/decisions/0051-one-style-vocabulary-over-edges.md),
 * "A bigger canvas becomes possible").
 *
 * A wider range is only useful if a surface stops drawing detail before that
 * detail turns to mush: below a scale a card keeps its title and drops its body
 * and metadata rows. The band is an attribute (`data-zoom-band`) the board root
 * carries, and the rules live in `styles/paint.css`; nothing here writes to the
 * document, and no card measures itself.
 */

/** How far out the camera may go; React Flow's default floor is 0.5. */
export const ZOOM_MIN = 0.05;
/** How far in it may go; React Flow's default ceiling is 2. */
export const ZOOM_MAX = 4;

export const zoomBands = ["far", "mid", "near"] as const;
export type ZoomBand = (typeof zoomBands)[number];

/** Below this scale a surface keeps its title and nothing else. */
export const ZOOM_MID_MIN = 0.35;
/** From this scale up a surface renders in full. */
export const ZOOM_NEAR_MIN = 0.75;

/**
 * The band a scale falls in. An unknown or non-finite scale reads as `near`, so
 * a surface never loses detail because a measurement failed.
 */
export function zoomBand(scale: number): ZoomBand {
  if (!Number.isFinite(scale)) return "near";
  if (scale < ZOOM_MID_MIN) return "far";
  if (scale < ZOOM_NEAR_MIN) return "mid";
  return "near";
}

/**
 * The range clamp. Presenting a tour is the one time the camera is left alone:
 * a stop may need to frame a card the author zoomed to, and a presentation that
 * silently rescales under the presenter is worse than a scale outside the
 * editing range (ADR-0051's investigation).
 */
export function clampZoom(scale: number, presenting = false): number {
  if (presenting) return scale;
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}
