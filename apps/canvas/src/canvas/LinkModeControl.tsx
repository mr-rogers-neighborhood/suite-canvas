import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useUiStore } from "../store/useUiStore";
import { type LinkMode, nextLinkMode } from "./linkGesture";
import { useLinkThreadStore } from "./linkThread";

/**
 * The three ways to draw a link ([ADR-0061](../../../docs/decisions/0061-three-ways-to-draw-links.md)).
 * Each glyph shows the *shape* its mode draws, which is why they read as a set:
 * one line, a chain, a star.
 */
const MODES: Record<LinkMode, { label: string; glyph: string }> = {
  connect: {
    label: "Connect mode: drag one link at a time",
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
};

/** "Switch to thread mode: click connector after connector to chain links". */
function switchLabel(mode: LinkMode): string {
  const target = nextLinkMode(mode);
  return `Switch to ${MODES[target].label.charAt(0).toLowerCase()}${MODES[target].label.slice(1)}`;
}

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
    const displayed = ctrlHeld.current ? "web" : shiftHeld.current ? "thread" : linkMode;
    node.dataset.hintMode = displayed;
    node.dataset.hint = displayed === linkMode ? "false" : "true";
    node.classList.toggle("is-thread", displayed === "thread");
    node.classList.toggle("is-web", displayed === "web");
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

  const current = MODES[linkMode];
  const active = linkMode !== "connect";

  // One button that walks a three-state cycle rather than a segmented control:
  // the three are one tool with three readings, and three buttons implied three
  // independent tools.
  return (
    <button
      ref={button}
      type="button"
      className={`link-mode-control${linkMode === "thread" ? " is-thread" : ""}${
        linkMode === "web" ? " is-web" : ""
      }`}
      aria-pressed={active}
      aria-label={`${current.label}. ${switchLabel(linkMode)}`}
      title={`${current.label}. ${switchLabel(linkMode)}`}
      data-testid="link-mode-toggle"
      data-mode={linkMode}
      data-hint-mode={linkMode}
      data-hint="false"
      // The canvas claims pointerdown for panning and selection and prevents the
      // default, which suppresses the click a nested control would otherwise get.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={() => {
        // Changing mode must also disarm whatever the old mode armed: an origin
        // from a web means something different once the mode is thread.
        useLinkThreadStore.getState().clear();
        setLinkMode(nextLinkMode(linkMode));
      }}
    >
      <span ref={glyph} aria-hidden="true">
        {current.glyph}
      </span>
    </button>
  );
}
