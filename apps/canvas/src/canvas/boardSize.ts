/**
 * The frame a freshly nested Board gets.
 *
 * A Board is drawn as a mat on its parent's desk, so it is shaped like the
 * content it holds: a miniature of a wide board reads as a wide frame instead
 * of a drawing letterboxed inside a square.
 */

/** Fallback frame for a Board whose content has never been measured. */
export const DEFAULT_BOARD_SIZE = { width: 288, height: 256 } as const;
/** Longest side of a new nested Board, and the clamps on the shorter one. */
const BOARD_LONG_SIDE = 300;
const BOARD_MIN_SIDE = 168;
const BOARD_MAX_SIDE = 340;

export function boardSizeForBounds(bounds: { width: number; height: number } | null): {
  width: number;
  height: number;
} {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { ...DEFAULT_BOARD_SIZE };
  const ratio = bounds.width / bounds.height;
  const clamp = (value: number) => Math.min(BOARD_MAX_SIDE, Math.max(BOARD_MIN_SIDE, value));
  if (ratio >= 1) {
    return { width: BOARD_LONG_SIDE, height: clamp(BOARD_LONG_SIDE / ratio) };
  }
  return { width: clamp(BOARD_LONG_SIDE * ratio), height: BOARD_LONG_SIDE };
}
