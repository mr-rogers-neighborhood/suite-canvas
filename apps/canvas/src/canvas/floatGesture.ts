import { useCallback, useEffect, useRef } from "react";
import type { FloatRect } from "./floatPlan";

/**
 * Dragging and resizing a surface that floats over the canvas.
 *
 * Pins and the handbook bubble move the same way: a press on the thing starts a gesture, the
 * pointer settles it on release, and the geometry after the drag is handed to
 * `planFloats` so it dodges whatever it landed on. The one difference is what is being
 * dragged, which is why the target is passed per gesture rather than held here.
 *
 * The listeners live on `window` for the length of the gesture's owner, not per drag: a
 * pointer that leaves the element has to keep moving it, and a pointer released outside the
 * window has to end it.
 */
export interface FloatGestureTarget {
  /** What the rect belongs to: a card id, or the bubble's own name. */
  readonly id: string;
  /** The rect as it was when the press began. */
  readonly rect: Omit<FloatRect, "id">;
  readonly mode: "move" | "resize";
}

export interface FloatGestureOptions {
  /** Called on every pointer move, with the rect the drag has produced so far. */
  onMove: (id: string, rect: Omit<FloatRect, "id">) => void;
  /** Called once on release, where a surface settles around its neighbours. */
  onEnd: () => void;
  /** A surface is not allowed to be dragged smaller than this. */
  minWidth?: number;
  minHeight?: number;
}

export interface FloatGesture {
  start: (event: { clientX: number; clientY: number }, target: FloatGestureTarget) => void;
}

interface Active extends FloatGestureTarget {
  readonly startX: number;
  readonly startY: number;
}

export function useFloatGesture(options: FloatGestureOptions): FloatGesture {
  const active = useRef<Active | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = active.current;
      if (!current) return;
      const { minHeight = 80, minWidth = 180 } = latest.current;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      const next: Omit<FloatRect, "id"> =
        current.mode === "move"
          ? { ...current.rect, x: current.rect.x + dx, y: current.rect.y + dy }
          : {
              ...current.rect,
              width: Math.max(minWidth, current.rect.width + dx),
              height: Math.max(minHeight, current.rect.height + dy),
            };
      latest.current.onMove(current.id, next);
    };
    const up = () => {
      if (active.current === null) return;
      active.current = null;
      // A surface dropped somewhere illegal settles on release rather than while it moves:
      // fighting the solver under the pointer feels like the thing is alive.
      latest.current.onEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const start = useCallback(
    (event: { clientX: number; clientY: number }, target: FloatGestureTarget) => {
      active.current = { ...target, startX: event.clientX, startY: event.clientY };
    },
    [],
  );

  return { start };
}
