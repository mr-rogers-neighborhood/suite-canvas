/**
 * Keyboard nudge for the selected cards.
 *
 * React Flow's own arrow-key move is one flow unit per press (four with Shift),
 * which is too fine to see at a normal zoom and produces one document write per
 * pixel of travel. The board reads the arrows itself with a step a reader can
 * feel, and Shift for a jump across the board.
 */

export interface NudgeDelta {
  dx: number;
  dy: number;
}

/** One arrow press. Eight flow units is a visible step without leaving the card's slot. */
export const NUDGE_STEP = 8;

/** One arrow press with Shift held. Far enough to cross a section in a few presses. */
export const NUDGE_LARGE_STEP = 40;

const ARROW_DELTAS: Readonly<Record<string, NudgeDelta>> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

/** True for the four keys the board nudges with. */
export function isNudgeKey(key: string): boolean {
  return Object.hasOwn(ARROW_DELTAS, key);
}

/** The move one arrow press makes, in flow units, or null for any other key. */
export function nudgeDelta(key: string, large: boolean): NudgeDelta | null {
  const direction = ARROW_DELTAS[key];
  if (!direction) return null;
  const step = large ? NUDGE_LARGE_STEP : NUDGE_STEP;
  return { dx: direction.dx * step, dy: direction.dy * step };
}
