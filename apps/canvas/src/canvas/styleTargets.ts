import type { SurfaceStyle } from "@suite/graph";
import { isEmptyStyle } from "@suite/graph";

/**
 * A style edit on a board, where more than one card is selected.
 *
 * The inspector edits one card. A multi-selection edits each of them, one surface
 * write per card, so a later edit to one card cannot move the others. There are no
 * rules and no scopes any more: the only question a bulk edit answers is "what do
 * these cards share", and the only thing it writes is each card's own style.
 */

export interface StyledCardTarget {
  id: string;
  style?: SurfaceStyle | undefined;
}

/** One card's write from a bulk edit; `null` clears the card's own style. */
export interface StyleWrite {
  cardId: string;
  style: SurfaceStyle | null;
}

/**
 * Merge a patch into one card's own style.
 *
 * A key the patch names is written, a key it leaves out keeps what the card had,
 * and a key set to `undefined` clears it — which is how "Default" reads in a
 * bulk bar. A record that ends up naming nothing is removed rather than stored,
 * so "reset" and "never set" stay the same state (ADR-0051).
 */
export function mergeStylePatch(
  style: SurfaceStyle | undefined,
  patch: SurfaceStyle,
): SurfaceStyle | null {
  const next: SurfaceStyle = { ...(style ?? {}) };
  const record = next as Record<string, unknown>;
  for (const key of Object.keys(patch) as (keyof SurfaceStyle)[]) {
    const value = patch[key];
    if (value === undefined) delete record[key];
    else record[key] = value;
  }
  return isEmptyStyle(next) ? null : next;
}

/**
 * What a bulk edit writes: one record per selected card, each keeping the paint
 * it already had outside the patched keys.
 *
 * The per-card record is deliberate. `@suite/graph` has no batched style write,
 * so a bulk edit is one surface write per card, and one undo step per card;
 * sharing a single record between cards would make one card's later edit move
 * every other card that happened to be selected with it.
 */
export function bulkStyleWrites(
  targets: readonly StyledCardTarget[],
  patch: SurfaceStyle,
): StyleWrite[] {
  return targets.map((target) => ({
    cardId: target.id,
    style: mergeStylePatch(target.style, patch),
  }));
}

/**
 * The value every selected card agrees on, so a bulk control can show it.
 *
 * `mixed` is what a "3 cards" bar has to say instead of pretending one card's
 * shape speaks for the others.
 */
export function sharedStyleValue<K extends "shape" | "surface">(
  targets: readonly StyledCardTarget[],
  key: K,
): { mixed: boolean; value: SurfaceStyle[K] | undefined } {
  const first = targets[0]?.style?.[key];
  const mixed = targets.some((target) => target.style?.[key] !== first);
  return { mixed, value: mixed ? undefined : first };
}
