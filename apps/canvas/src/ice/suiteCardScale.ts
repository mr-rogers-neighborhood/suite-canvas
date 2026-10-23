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
 */

/** The card's natural size — Suite's `DEFAULT_CARD_WIDTH/HEIGHT`, in world units. */
export const CARD_BASE_EXTENT = { width: 288, height: 240 } as const;

/**
 * The rungs a card may take. `1` is the base kind (`suite.card`); every other
 * rung is a sibling kind with the same parts and a larger hand.
 */
export const SUITE_TYPE_LADDER = [1, 2] as const;

export type CardTypeScale = (typeof SUITE_TYPE_LADDER)[number];

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
 * type from growing before the box has room for it.
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
  let chosen: CardTypeScale = SUITE_TYPE_LADDER[0] as CardTypeScale;
  for (const rung of SUITE_TYPE_LADDER) {
    if (ratio + 1e-6 >= rung) chosen = rung;
  }
  return chosen;
}
