/**
 * Press-and-hold repetition for the zoom buttons.
 *
 * A single click is one step; holding the button should keep stepping, the way
 * every map and canvas control behaves. The grammar matters more than the
 * mechanic: the first step is immediate (so a click never feels late), the
 * repeat only starts after a short hold, and it runs at a steady rate that is
 * fast enough to feel continuous and slow enough to stop where you meant.
 *
 * Pointer and keyboard are both supported. A pointer press fires immediately on
 * `pointerdown`; the click that follows is swallowed so the step is not doubled.
 * `MouseEvent.detail` is the discriminator: a pointer-generated click carries a
 * non-zero detail, a keyboard or assistive-technology click carries 0. That is
 * more reliable than a timestamp or a flag cleared by a timer, because a click
 * always follows its pointerup in the same task.
 */
import { useCallback, useEffect, useRef } from "react";

/** How long the button must be held before it starts repeating. */
export const HOLD_DELAY_MS = 260;
/** Interval between repeats once it has started. */
export const HOLD_INTERVAL_MS = 70;

export interface HoldRepeatHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: (event: React.MouseEvent) => void;
}

/**
 * `repeat` is how many steps deep into a hold this call is: 0 for the press
 * itself, then 1, 2, 3… The action can use it to accelerate, so a held button
 * covers ground instead of stepping at one fixed speed.
 */
export type HoldAction = (repeat: number) => void;

export function useHoldRepeat(
  action: HoldAction,
  options: { delayMs?: number; intervalMs?: number } = {},
): HoldRepeatHandlers {
  const delayMs = options.delayMs ?? HOLD_DELAY_MS;
  const intervalMs = options.intervalMs ?? HOLD_INTERVAL_MS;
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const repeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Keep the latest action without restarting a hold that is in progress.
  const latest = useRef(action);
  latest.current = action;
  /** How many repeats this hold has produced, for gradual acceleration. */
  const count = useRef(0);

  const stop = useCallback(() => {
    if (delay.current !== undefined) {
      clearTimeout(delay.current);
      delay.current = undefined;
    }
    if (repeat.current !== undefined) {
      clearInterval(repeat.current);
      repeat.current = undefined;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      count.current = 0;
      latest.current(0);
      stop();
      delay.current = setTimeout(() => {
        delay.current = undefined;
        repeat.current = setInterval(() => {
          count.current += 1;
          latest.current(count.current);
        }, intervalMs);
      }, delayMs);
    },
    [delayMs, intervalMs, stop],
  );

  const end = useCallback(() => stop(), [stop]);

  const onClick = useCallback((event: React.MouseEvent) => {
    // The pointer path already stepped on pointerdown.
    if (event.detail > 0) {
      event.preventDefault();
      return;
    }
    latest.current(0);
  }, []);

  return {
    onPointerDown,
    onPointerUp: end,
    onPointerLeave: end,
    onPointerCancel: end,
    onClick,
  };
}
