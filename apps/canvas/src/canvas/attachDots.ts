import type { Connector } from "@suite/graph";

/**
 * Which dots a placed card attaches through.
 *
 * A card dropped while a mode other than `place` is chosen gets one link back to its
 * anchor, and the line has to look deliberate: out of the dot facing the anchor, into the
 * dot facing that. Left to a default side it would loop around a card, which reads as a
 * mistake rather than a relationship.
 *
 * Pure: boxes and dots in, dots out, no React and no Loro, so the preview and the write
 * can share it.
 */

/** A card's box in flow units, which is all this geometry needs. */
export interface FacingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A dot's point in flow space: the fraction it sits at, times the box it belongs to. */
export function dotPoint(box: FacingBox, dot: Connector): { x: number; y: number } {
  return { x: box.x + dot.x * box.width, y: box.y + dot.y * box.height };
}

export function boxCentre(box: FacingBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The dot nearest `toward`, measured on the card's own perimeter.
 *
 * "Nearest" rather than "the one at exactly (1, 0.5)": a reader may move or delete dots,
 * and the honest answer to "which dot faces that" is the one that is closest.
 */
export function connectorToward(
  connectors: readonly Connector[],
  box: FacingBox,
  toward: { x: number; y: number },
): Connector | undefined {
  let best: Connector | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const connector of connectors) {
    const point = dotPoint(box, connector);
    const distance = (point.x - toward.x) ** 2 + (point.y - toward.y) ** 2;
    if (distance < bestDistance) {
      best = connector;
      bestDistance = distance;
    }
  }
  return best;
}

export interface AttachDots {
  source: Connector | null;
  target: Connector | null;
}

/**
 * The two dots a link between two placed cards uses.
 *
 * The line leaves the anchor through the dot facing the new card, and arrives through
 * the new card's dot facing *that dot* rather than its centre. Aiming the arrival at the
 * departure is what makes a fan read as a starburst: every spoke leaves on one side and
 * lands on the opposite one.
 */
export function attachDots(input: {
  anchorDots: readonly Connector[];
  anchorBox: FacingBox;
  cardDots: readonly Connector[];
  cardBox: FacingBox;
}): AttachDots {
  const source =
    connectorToward(input.anchorDots, input.anchorBox, boxCentre(input.cardBox)) ?? null;
  const departure =
    source === null ? boxCentre(input.anchorBox) : dotPoint(input.anchorBox, source);
  const target = connectorToward(input.cardDots, input.cardBox, departure) ?? null;
  return { source, target };
}

/**
 * Where a placement lands relative to the pointer: half the card across and its header
 * down, which is what a drop under the hand means.
 */
export const DROP_HALF_WIDTH = 144;
export const DROP_HALF_HEIGHT = 60;
