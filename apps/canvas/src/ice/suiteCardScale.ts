/**
 * A card's type size, as a ladder of object kinds.
 *
 * ICE lays a note's writing out at the *kind's* em (`layoutText` reads
 * `law.size`), so a single card cannot have its own font size: the size is a
 * property of the kind. A card that should grow its type as it grows therefore
 * has to become a different kind, and the honest way to do that is a small
 * ladder of rungs rather than a continuum.
 *
 * The ladder is powers of two on purpose. That is the shape the engine already
 * uses for its ink: a note's raster bands are powers of two between
 * `BAND_MIN` and `BAND_MAX`, so a type rung that doubles lines up with the band
 * that would raster it — one layout per rung, never a re-layout per pixel. It
 * also gives the fractal reading for free: nesting a card inside a container
 * that is half the size lands it on the next rung down.
 *
 * The rung is derived from the card's own extent, so resizing the card IS the
 * control: no extra gesture, and no extra document field. Text is never
 * resampled within a rung, which is what keeps a card's type crisp.
 *
 * A resize drag therefore has two readings, and `cardScaleForResize` is the one
 * place that decides between them:
 *
 * - **Similarity (default).** The box and its hand scale together: the rung is
 *   read from the box the drag resolved, with the same `scaleForExtent` the
 *   projection uses, so the committed box and the committed rung can never
 *   disagree. As the box crosses a rung's threshold the card steps to its
 *   neighbour — one gesture, one commit at pointer-up.
 * - **Reflow (Shift).** The box changes and the rung stays where it was, so the
 *   text reflows inside a bigger or smaller card instead of growing with it.
 */

/** The card's natural size — Suite's `DEFAULT_CARD_WIDTH/HEIGHT`, in world units. */
export const CARD_BASE_EXTENT = { width: 288, height: 240 } as const;

/**
 * The rungs a card may take. `1` is the base kind (`suite.card`); every other
 * rung is a sibling kind with the same parts and a hand scaled by that rung.
 *
 * The floor is the ladder's first rung and the cap is its last: shrinking a card
 * below its natural size has to shrink the type with it (otherwise a tiny box
 * holds huge writing), and growth stops at the top rung because past it the
 * added area is page, not larger letters. Every policy here reads the ladder's
 * ends rather than hard-coding them, so adding a rung (the locked `0.5 · 1 · 2 ·
 * 3`) is purely additive on this side.
 */
export const SUITE_TYPE_LADDER = [0.5, 1, 2, 3] as const;

export type CardTypeScale = (typeof SUITE_TYPE_LADDER)[number];

/** The base rung: the card's natural hand, and the bare `suite.card` type. */
export const CARD_BASE_SCALE: CardTypeScale = 1;

/** The smallest hand a card may take — the ladder's floor. */
export const MIN_CARD_TYPE_SCALE: CardTypeScale = SUITE_TYPE_LADDER[0];

/** The largest hand a card may take — the ladder's top rung. */
export const MAX_CARD_TYPE_SCALE: CardTypeScale =
  SUITE_TYPE_LADDER[SUITE_TYPE_LADDER.length - 1] ?? CARD_BASE_SCALE;

/**
 * A rung's type-name suffix. The base rung keeps the bare type so existing
 * placements, tests and the bridge's `suite.card` picks stay valid.
 */
export function cardTypeForScale(scale: number): string {
  return scale === 1 ? "suite.card" : `suite.card@${scale}`;
}

/** Every card type the surface registers with the desk. */
export const SUITE_CARD_TYPES: readonly string[] = SUITE_TYPE_LADDER.map(cardTypeForScale);

/** Is this one of our card kinds (any rung)? */
export function isSuiteCardType(type: string | undefined): boolean {
  return type !== undefined && SUITE_CARD_TYPES.includes(type);
}

/**
 * The rung a card of this extent takes: the largest rung the card is at least
 * that big for, in either axis. A card at its natural size is rung 1; a card
 * twice as tall or twice as wide is rung 2. Snapping DOWN (never up) keeps the
 * type from growing before the box has room for it; below the floor the ladder
 * bottoms out at the floor rather than shrinking further.
 */
export function scaleForExtent(extent: {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}): CardTypeScale {
  const width = extent.width;
  const height = extent.height;
  const ratio = Math.max(
    width === undefined || !Number.isFinite(width) ? 1 : width / CARD_BASE_EXTENT.width,
    height === undefined || !Number.isFinite(height) ? 1 : height / CARD_BASE_EXTENT.height,
  );
  let chosen: CardTypeScale = MIN_CARD_TYPE_SCALE;
  for (const rung of SUITE_TYPE_LADDER) {
    if (ratio + 1e-6 >= rung) chosen = rung;
  }
  return chosen;
}

/** Is this number one of the ladder's rungs? */
export function isCardTypeScale(value: number): value is CardTypeScale {
  return (SUITE_TYPE_LADDER as readonly number[]).includes(value);
}

/**
 * The nearest rung a hand may legally take: below the floor becomes the floor,
 * above the cap becomes the cap, and a value between two rungs snaps down (the
 * same never-grow-before-the-box-has-room rule `scaleForExtent` follows).
 * A non-finite hand is the base hand.
 */
export function clampCardTypeScale(scale: number): CardTypeScale {
  if (!Number.isFinite(scale)) return CARD_BASE_SCALE;
  let chosen: CardTypeScale = MIN_CARD_TYPE_SCALE;
  for (const rung of SUITE_TYPE_LADDER) {
    if (scale + 1e-6 >= rung) chosen = rung;
  }
  return chosen;
}

export interface CardResizeScaleInput {
  /** The box the drag resolved to, in board units (already floor-clamped). */
  readonly extent: {
    readonly width?: number | undefined;
    readonly height?: number | undefined;
  };
  /** Shift: the box changes and the hand stays, so the text reflows. */
  readonly reflow?: boolean | undefined;
  /** The hand the card had at pointer-down; defaults to its start box's rung. */
  readonly startScale?: number | undefined;
}

/**
 * The rung a card resize lands on. Similarity by default: the rung comes from
 * the box the drag resolved, through the very mapping the projection uses, so
 * the two never drift. With `reflow` (Shift) the box still changes but the hand
 * is pinned to the rung the gesture started on, clamped into the ladder.
 */
export function cardScaleForResize(input: CardResizeScaleInput): CardTypeScale {
  if (input.reflow === true) {
    return clampCardTypeScale(input.startScale ?? scaleForExtent(input.extent));
  }
  return scaleForExtent(input.extent);
}
