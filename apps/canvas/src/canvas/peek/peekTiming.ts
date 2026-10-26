/**
 * The delay and dismissal rules (ADR-0055).
 *
 * These numbers are the whole difficulty of a peek. Too eager and it fights selection:
 * a pointer crossing the outline would flash a card at every row. Too slow and nobody
 * discovers it. 450 ms is long enough to tell a passing pointer from a rest.
 *
 * Leaving a trigger starts a 120 ms grace rather than closing at once, so the pointer
 * can cross the gap into the peek and use its one route. A click is never a peek, which
 * is why focus that arrived from a pointer waits `pointerFocusGraceMs` and focus that
 * arrived from the keyboard does not: tabbing to a row is a rest by definition.
 */
export interface PeekTiming {
  /** Rest on a trigger this long before the peek opens. */
  openAfterMs: number;
  /** Grace after leaving a trigger or the peek itself. */
  closeAfterMs: number;
  /** A focus this soon after a pointer press came from that press. */
  pointerFocusGraceMs: number;
}

export const peekTiming: PeekTiming = {
  openAfterMs: 450,
  closeAfterMs: 120,
  pointerFocusGraceMs: 250,
};
