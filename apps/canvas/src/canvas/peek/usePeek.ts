import type { Target } from "@suite/graph";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeLayer } from "../../shell/escapeLayers";
import type { PeekEntity } from "./peekResolver";
import { type PeekTiming, peekTiming } from "./peekTiming";

/** Where the peek was opened from, in viewport coordinates. */
export interface PeekAnchor {
  x: number;
  y: number;
}

export interface PeekState {
  entity: PeekEntity;
  anchor: PeekAnchor | null;
}

/**
 * What a trigger and a peek surface need from one another.
 *
 * `hover` is the pointer rule, `focus` is the keyboard rule, `leave` and `stay` are the
 * grace period between the trigger and the surface, and `dismiss` is everything else:
 * Escape, a pointer press anywhere, a scroll or a zoom. Keeping the dismissal rules here
 * rather than in each surface is what makes "a click is never a peek" true everywhere.
 */
export interface PeekController {
  peek: PeekState | null;
  hover(target: Target, anchor?: PeekAnchor | null): void;
  focus(target: Target, anchor?: PeekAnchor | null): void;
  leave(): void;
  stay(): void;
  dismiss(): void;
}

/**
 * The timer half of hover-peek, with no DOM of its own.
 *
 * The resolver is injected so the same controller serves any snapshot shape and a test
 * can hand it two entities. The window listeners live here because dismissal must not
 * depend on a surface remembering to ask: a peek that survives a board switch is a bug
 * nobody would think to test per surface.
 */
export function usePeek(
  resolve: (target: Target) => PeekEntity | null,
  timing: PeekTiming = peekTiming,
): PeekController {
  const [peek, setPeek] = useState<PeekState | null>(null);
  const resolveRef = useRef(resolve);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const pending = useRef<{ target: Target; anchor: PeekAnchor | null } | null>(null);
  const lastPointerDown = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    resolveRef.current = resolve;
  }, [resolve]);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    // `null` to `null` bails out, so a pointer press with nothing open costs no render.
    setPeek(null);
  }, [clearTimers]);

  // Escape is a stack, not a race: while a peek is open it is the top layer, so the key
  // closes the peek and the canvas behind it does not also clear the selection.
  useEscapeLayer(dismiss, peek !== null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      lastPointerDown.current = Date.now();
      // A press inside the peek is the reader using the one route it offers, not a
      // dismissal: closing here would remove the button before its click landed.
      const target = event.target;
      if (target instanceof Element && target.closest("[data-peek-surface]")) return;
      dismiss();
    };
    const onScrollOrZoom = () => dismiss();

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("wheel", onScrollOrZoom, { capture: true, passive: true });
    window.addEventListener("scroll", onScrollOrZoom, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("wheel", onScrollOrZoom, true);
      window.removeEventListener("scroll", onScrollOrZoom, true);
    };
  }, [dismiss]);

  useEffect(() => clearTimers, [clearTimers]);

  const hover = useCallback(
    (target: Target, anchor: PeekAnchor | null = null) => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      // The pointer may cross several rows inside one delay; the timer answers for the
      // row it is resting on when it fires, not the one that started the wait.
      pending.current = { target, anchor };
      if (openTimer.current !== null) return;
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null;
        const waiting = pending.current;
        pending.current = null;
        if (!waiting) return;
        const entity = resolveRef.current(waiting.target);
        setPeek(entity ? { entity, anchor: waiting.anchor } : null);
      }, timing.openAfterMs);
    },
    [timing.openAfterMs],
  );

  const focus = useCallback(
    (target: Target, anchor: PeekAnchor | null = null) => {
      // A focus that followed a press is that press arriving, not a rest. Opening here
      // would put a peek over the card the reader just selected.
      if (Date.now() - lastPointerDown.current < timing.pointerFocusGraceMs) return;
      clearTimers();
      const entity = resolveRef.current(target);
      setPeek(entity ? { entity, anchor } : null);
    },
    [clearTimers, timing.pointerFocusGraceMs],
  );

  const leave = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    pending.current = null;
    if (closeTimer.current !== null) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPeek(null);
    }, timing.closeAfterMs);
  }, [timing.closeAfterMs]);

  const stay = useCallback(() => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  return { peek, hover, focus, leave, stay, dismiss };
}
