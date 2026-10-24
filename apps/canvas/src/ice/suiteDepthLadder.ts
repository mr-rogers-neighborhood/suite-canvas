/**
 * Map a layout plan's scale to the card type rung a card should take.
 *
 * A plan says how big a card should be relative to its natural size
 * (`LayoutPlacement.scale`); the type ladder in `./suiteCardScale` says which
 * kinds exist. Those are two different ladders — one is continuous, one is a
 * handful of rungs — so this module is the single place that snaps one onto the
 * other.
 *
 * It never grows a card's kind beyond the rungs that the surface registers, and
 * it never invents a kind for a size the ladder cannot express.
 */

import type { LayoutPlacement } from "@suite/scene";
import {
  CARD_BASE_SCALE,
  type CardTypeScale,
  cardTypeForScale,
  MIN_CARD_TYPE_SCALE,
  SUITE_TYPE_LADDER,
} from "./suiteCardScale";

/** Slack for floating-point scales that were produced by repeated multiplication. */
export const DEPTH_LADDER_EPSILON = 1e-6;

/**
 * The rung for a plan scale.
 *
 * Snapping goes DOWN, exactly like `scaleForExtent`: a card only takes a bigger
 * kind once its box has room for that kind. A scale below the ladder's floor is
 * clamped up to it and a scale above its cap is clamped down to it (the loop
 * cannot pass the cap), so the result is always a registered rung. Anything that
 * is not a positive finite number returns `null`: there is no honest rung for
 * "no scale".
 */
export function depthRungForScale(scale: number | null | undefined): CardTypeScale | null {
  if (scale === null || scale === undefined) return null;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  let chosen: CardTypeScale = MIN_CARD_TYPE_SCALE;
  for (const rung of SUITE_TYPE_LADDER) {
    if (scale + DEPTH_LADDER_EPSILON >= rung) chosen = rung;
  }
  return chosen;
}

/** The scale a placement was planned at; a flat plan keeps the base size. */
export function depthScaleOfPlacement(placement: Pick<LayoutPlacement, "scale">): number {
  const scale = placement.scale;
  if (scale !== undefined && Number.isFinite(scale) && scale > 0) return scale;
  return CARD_BASE_SCALE;
}

/** The rung a placement takes, or `null` when the plan carried no usable scale. */
export function depthRungForPlacement(
  placement: Pick<LayoutPlacement, "scale">,
): CardTypeScale | null {
  return depthRungForScale(depthScaleOfPlacement(placement));
}

/**
 * The registered card type for a plan scale — the rung's `suite.card` flavour.
 * `null` means "keep the kind you already have": the plan did not carry a scale
 * the ladder can express.
 */
export function depthCardTypeForScale(scale: number | null | undefined): string | null {
  const rung = depthRungForScale(scale);
  return rung === null ? null : cardTypeForScale(rung);
}
