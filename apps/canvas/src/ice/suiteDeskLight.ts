/**
 * The desk's shipped dapple, switched off.
 *
 * ICE's desk projects a gobo — a dappled light pattern — from a fixed point.
 * On a desk that is mostly empty that projector covers a fixed patch and reads
 * as a wedge of someone else's tree: static, unexplained, and louder than the
 * work on top of it. The canvas supplies its own light, so the mat's gobo goes
 * to zero opacity and stays there.
 *
 * `configureMat` merges into the live mat config, so this only needs to land
 * once per desk handle; the theme's own mat never writes `gobo` and cannot
 * bring it back.
 */

/** The narrow slice of the desk handle this needs (`configureMat`, host/layer.d.ts). */
export interface SuiteLightDesk {
  configureMat(mat: { gobo: { opacity: number } }): void;
}

/** A gobo with no light through it. */
export const SUITE_GOBO_OFF = { gobo: { opacity: 0 } } as const;

const configured = new WeakSet<SuiteLightDesk>();

/** Switch the desk's dapple off. Idempotent per desk handle. */
export function applySuiteDeskLight(desk: SuiteLightDesk): void {
  if (configured.has(desk)) return;
  configured.add(desk);
  desk.configureMat(SUITE_GOBO_OFF);
}
