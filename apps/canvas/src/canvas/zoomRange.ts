/**
 * The camera's usable range and the content breakpoints that go with it
 * (ADR-0051,
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
 * How far a label may counter-scale before it stops.
 *
 * A label is drawn at `1/zoom` so it stays the same size on the screen, which is what makes a name
 * readable at any distance. Past this floor that stops being helpful: every frame and every link
 * keeps its full screen size however far out the reader goes, and the labels become a wall of pills
 * over a map the reader is trying to read as a shape. Below the floor they shrink with the board
 * instead, and `styles/paint.css` takes the link labels away entirely in the `far` band.
 */
export const LABEL_SCALE_FLOOR = 0.5;

/**
 * The counter-scale a label is painted at: `1/zoom`, bounded below by the floor.
 *
 * The bounds are on the *zoom*, so the returned factor is never larger than `1/LABEL_SCALE_FLOOR`.
 * A failed measurement reads as 1, the way `zoomBand` treats it, so a label never disappears because
 * a transform was missing.
 */
export function labelScale(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return 1 / Math.max(zoom, LABEL_SCALE_FLOOR);
}

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
