import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useUiStore } from "../store/useUiStore";
import { type CanvasMode, nextMode } from "./linkGesture";
import { useLinkThreadStore } from "./linkThread";

/**
 * The mode family ([ADR-0061](../../../docs/decisions/0061-three-ways-to-draw-links.md),
 * [ADR-0063](../../../docs/decisions/0063-placement-is-a-mode-too.md)). Each glyph
 * shows the *shape* its mode draws, which is why they read as a set: one thing, a
 * chain, a star, a tree.
 */
const MODES: Record<CanvasMode, { label: string; glyph: string }> = {
  place: {
    label: "Place mode: one at a time — drag a link, or drop a card",
    glyph: "\u2194",
  },
  thread: {
    label: "Thread mode: click connector after connector to chain links",
    glyph: "\u2933",
  },
  web: {
    label: "Web mode: every click links from the same starting connector",
    glyph: "\u273b",
  },
  pattern: {
    label: "Pattern mode: each placement branches from the one before it",
    glyph: "\u22b9",
  },
};

/** "Switch to thread mode: click connector after connector to chain links". */
function switchLabel(mode: CanvasMode): string {
  const target = nextMode(mode);
  return `Switch to ${MODES[target].label.charAt(0).toLowerCase()}${MODES[target].label.slice(1)}`;
}

/**
 * The link tool in the viewport widget bar, beside zoom and fit. Thread mode
 * lets a plain click chain links; shift-click does the same in connect mode,
 * which is why the two live together rather than as separate tools.
 */
export function ModeControl() {
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  const canCreateContent = useUiStore((state) => state.canCreateContent);

  const button = useRef<HTMLButtonElement | null>(null);
  const glyph = useRef<HTMLSpanElement | null>(null);
  /**
   * Whether Shift is held right now. Shift is the one gesture that chains links
   * without the thread tool, so holding it shows what the toggle would do. A ref
   * painted onto the DOM, never state: a re-render mid-gesture is exactly what
   * the hint must not cause.
   */
  const shiftHeld = useRef(false);
  /** Control (or Command) held: the same preview, for the third mode. */
  const ctrlHeld = useRef(false);

  /**
   * Paints the *displayed* mode on the button. `data-mode` and the click path
   * stay the stored mode; `data-hint-mode`, the `is-thread` look and the glyph
   * follow what the reader is doing, so holding Shift flips the indicator and
   * releasing it flips it back.
   */
  const paintHint = useCallback(() => {
    const node = button.current;
    if (!node) return;
    // Ctrl wins over Shift when both are down: it is the more specific gesture,
    // and a web from a fixed origin is what the reader is about to draw.
    const displayed = ctrlHeld.current ? "web" : shiftHeld.current ? "thread" : mode;
    node.dataset.hintMode = displayed;
    node.dataset.hint = displayed === mode ? "false" : "true";
    node.classList.toggle("is-thread", displayed === "thread");
    node.classList.toggle("is-web", displayed === "web");
    node.classList.toggle("is-pattern", displayed === "pattern");
    if (glyph.current) glyph.current.textContent = MODES[displayed].glyph;
  }, [mode]);

  // A commit restores the stored class and glyph from JSX, so the hint is
  // re-applied before the browser paints — still without a state update of its
  // own, and with no flash of the stored mode while a gesture is in flight.
  useLayoutEffect(() => {
    paintHint();
  });

  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      if (event.shiftKey === shiftHeld.current && event.ctrlKey === ctrlHeld.current) return;
      shiftHeld.current = event.shiftKey;
      ctrlHeld.current = event.ctrlKey;
      paintHint();
    };
    const release = () => {
      if (!shiftHeld.current && !ctrlHeld.current) return;
      shiftHeld.current = false;
      ctrlHeld.current = false;
      paintHint();
    };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", release);
    };
  }, [paintHint]);

  if (!canCreateContent) return null;

  const current = MODES[mode];
  const active = mode !== "place";

  // One button that walks a four-state cycle rather than a segmented control:
  // the four are one tool with four readings, and four buttons would imply four
  // independent tools — which is exactly the mistake the second arm would make.
  return (
    <button
      ref={button}
      type="button"
      className={`link-mode-control${mode === "thread" ? " is-thread" : ""}${
        mode === "web" ? " is-web" : ""
      }${mode === "pattern" ? " is-pattern" : ""}`}
      aria-pressed={active}
      aria-label={`${current.label}. ${switchLabel(mode)}`}
      title={`${current.label}. ${switchLabel(mode)}`}
      data-testid="link-mode-toggle"
      data-mode={mode}
      data-hint-mode={mode}
      data-hint="false"
      // The canvas claims pointerdown for panning and selection and prevents the
      // default, which suppresses the click a nested control would otherwise get.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={() => {
        // Changing mode must also disarm whatever the old mode armed: an origin
        // from a web means something different once the mode is thread.
        useLinkThreadStore.getState().clear();
        setMode(nextMode(mode));
      }}
    >
      <span ref={glyph} aria-hidden="true">
        {current.glyph}
      </span>
    </button>
  );
}
