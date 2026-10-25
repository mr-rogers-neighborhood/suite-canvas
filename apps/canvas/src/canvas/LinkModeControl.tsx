import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useUiStore } from "../store/useUiStore";
import { useLinkThreadStore } from "./linkThread";

const MODES = {
  connect: {
    label: "Connect mode: drag one link at a time",
    next: "Switch to thread mode: click connector after connector to chain links",
    glyph: "\u2194",
  },
  thread: {
    label: "Thread mode: click connector after connector to chain links",
    next: "Switch to connect mode: drag one link at a time",
    glyph: "\u2933",
  },
} as const;

/**
 * The link tool in the viewport widget bar, beside zoom and fit. Thread mode
 * lets a plain click chain links; shift-click does the same in connect mode,
 * which is why the two live together rather than as separate tools.
 */
export function LinkModeControl() {
  const linkMode = useUiStore((state) => state.linkMode);
  const setLinkMode = useUiStore((state) => state.setLinkMode);
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

  /**
   * Paints the *displayed* mode on the button. `data-mode` and the click path
   * stay the stored mode; `data-hint-mode`, the `is-thread` look and the glyph
   * follow what the reader is doing, so holding Shift flips the indicator and
   * releasing it flips it back.
   */
  const paintHint = useCallback(() => {
    const node = button.current;
    if (!node) return;
    const displayed = shiftHeld.current ? "thread" : linkMode;
    node.dataset.hintMode = displayed;
    node.classList.toggle("is-thread", displayed === "thread");
    if (glyph.current) glyph.current.textContent = MODES[displayed].glyph;
  }, [linkMode]);

  // A commit restores the stored class and glyph from JSX, so the hint is
  // re-applied before the browser paints — still without a state update of its
  // own, and with no flash of the stored mode while a gesture is in flight.
  useLayoutEffect(() => {
    paintHint();
  });

  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      if (event.shiftKey === shiftHeld.current) return;
      shiftHeld.current = event.shiftKey;
      paintHint();
    };
    const release = () => {
      if (!shiftHeld.current) return;
      shiftHeld.current = false;
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

  const current = MODES[linkMode];
  const thread = linkMode === "thread";

  // One button that swaps state, not a segmented control: the mode is a toggle,
  // and two buttons implied two independent tools.
  return (
    <button
      ref={button}
      type="button"
      className={`link-mode-control${thread ? " is-thread" : ""}`}
      aria-pressed={thread}
      aria-label={thread ? current.label : current.next}
      title={thread ? current.next : current.label}
      data-testid="link-mode-toggle"
      data-mode={linkMode}
      data-hint-mode={linkMode}
      // The canvas claims pointerdown for panning and selection and prevents the
      // default, which suppresses the click a nested control would otherwise get.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={() => {
        // Turning thread mode off must also disarm whatever the mode armed.
        useLinkThreadStore.getState().clear();
        setLinkMode(thread ? "connect" : "thread");
      }}
    >
      <span ref={glyph} aria-hidden="true">
        {current.glyph}
      </span>
    </button>
  );
}
