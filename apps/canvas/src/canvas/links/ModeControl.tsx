import { useUiStore } from "../../store/useUiStore";
import { type CanvasMode, canvasModes, nextMode } from "./linkGesture";

/**
 * The link tool: one button that cycles place → thread → fan (ADR-0061, ADR-0064).
 *
 * A glyph, not a word: the pill is 26px wide and the three shapes are drawn by the
 * glyphs themselves — one link, a chain, a star. The title names the mode in force and
 * the one the next click chooses, so the label reads without a legend.
 *
 * This is a *link* tool. Drag a dot to a dot in any mode; the mode decides what a pair
 * of clicks does, and — with a card in hand from the library — what a placement attaches
 * to (`canvas/attachDots.ts`).
 */
export const MODES: Record<CanvasMode, { label: string; glyph: string }> = {
  place: {
    label: "Place mode: one link at a time",
    glyph: "\u2194",
  },
  thread: {
    label: "Thread mode: each click chains from the dot you clicked",
    glyph: "\u2933",
  },
  fan: {
    label: "Fan mode: every click links from the same origin dot",
    glyph: "\u273b",
  },
};

/** "Switch to thread mode: each click chains from the dot you clicked". */
export function switchLabel(mode: CanvasMode): string {
  const next = MODES[nextMode(mode)];
  return `Switch to ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}`;
}

export function ModeControl() {
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  // A viewer cannot draw links, so the button would cycle a mode that writes nothing.
  const canManageLinks = useUiStore((state) => state.canManageLinks);
  if (!canManageLinks) return null;

  return (
    <button
      type="button"
      className="link-mode-control"
      data-testid="link-mode-toggle"
      data-mode={mode}
      aria-label={MODES[mode].label}
      title={switchLabel(mode)}
      onClick={() => setMode(nextMode(mode))}
    >
      <span aria-hidden="true" data-testid="link-mode-glyph">
        {MODES[mode].glyph}
      </span>
    </button>
  );
}

/** The modes in the order the button cycles them; exported for tests and the pill. */
export const MODE_CYCLE: readonly CanvasMode[] = canvasModes;
