import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useUiStore } from "../store/useUiStore";
import { type CanvasMode, canvasModes, nextMode } from "./linkGesture";
import { useLinkThreadStore } from "./linkThread";
import {
  heldKey,
  isHeld,
  isTextEntry,
  type ModifierState,
  modifiersOf,
  NO_MODIFIERS,
  previewedValue,
} from "./modifierPreview";
import { usePlacementRunStore } from "./placementRun";
import type { PlacementEngine } from "./usePlacementEngine";

/**
 * The mode family ([ADR-0061](../../../docs/decisions/0061-three-ways-to-draw-links.md),
 * [ADR-0063](../../../docs/decisions/0063-placement-is-a-mode-too.md)). Each glyph
 * shows the *shape* its mode draws, which is why they read as a set: one thing, a
 * chain, a star, a tree.
 */
export const MODES: Record<CanvasMode, { label: string; glyph: string }> = {
  place: {
    label: "Place mode: one at a time — drag a link, or drop a card",
    glyph: "\u2194",
  },
  thread: {
    label: "Thread mode: click connector after connector to chain links",
    glyph: "\u2933",
  },
  fan: {
    label: "Fan mode: every click links from the same starting connector",
    glyph: "\u273b",
  },
  branch: {
    label: "Branch mode: each placement branches from the one before it",
    glyph: "\u22d4",
  },
};

/** "Switch to thread mode: click connector after connector to chain links". */
function switchLabel(mode: CanvasMode): string {
  const target = nextMode(mode);
  return `Switch to ${MODES[target].label.charAt(0).toLowerCase()}${MODES[target].label.slice(1)}`;
}

/** "Thread mode", the name without the clause after the colon, for a label that embeds it. */
export function shortLabel(mode: CanvasMode): string {
  return MODES[mode].label.split(":")[0] ?? MODES[mode].label;
}

/**
 * The link tool in the viewport widget bar, beside zoom and fit. Thread mode
 * lets a plain click chain links; shift-click does the same in connect mode,
 * which is why the two live together rather than as separate tools.
 */
export interface ModeControlProps {
  /**
   * The placement engine, when the host has one. Absent in a story or a test,
   * where the control still shows and cycles the mode — the run UI simply cannot
   * appear without a run, and a run cannot start without the engine.
   */
  engine?: PlacementEngine | undefined;
}

export function ModeControl({ engine }: ModeControlProps = {}) {
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  const canCreateContent = useUiStore((state) => state.canCreateContent);
  // A live run turns this control into its progress and steering wheel: the mode
  // that decided where the last card went is the mode that decides the next one.
  const run = usePlacementRunStore((state) => state.run);

  const button = useRef<HTMLButtonElement | null>(null);
  const glyph = useRef<HTMLSpanElement | null>(null);
  /**
   * The modifiers held right now, as one value both controls can read
   * ([ADR-0066](../../../docs/decisions/0066-one-modifier-vocabulary-and-a-purpose-that-explains.md)).
   * Shift chains links without the thread tool, ctrl previews the fan, and alt
   * previews the branch — the fourth mode, which had no key before.
   *
   * A ref painted onto the DOM, never state: a re-render mid-gesture is exactly
   * what the hint must not cause.
   */
  const held = useRef<ModifierState>(NO_MODIFIERS);

  /**
   * Paints the *displayed* mode on the button. `data-mode` and the click path stay the
   * stored mode; `data-preview` and the glyph follow what the reader is doing, so
   * holding a key flips the indicator and releasing it flips it back.
   *
   * `data-preview` and not a hint class: a class can only *add* a look, and previewing
   * the resting `place` from `thread` has to remove one. With classes the stored
   * mode's mapping kept winning and the chip stayed inverted over a dark glyph.
   */
  const paintHint = useCallback(() => {
    const node = button.current;
    if (!node) return;
    // The family's own order decides which modifier is which; `null` means the
    // resting state, so the stored mode shows and nothing is hinted.
    const displayed = previewedValue(canvasModes, held.current, mode) ?? mode;
    const hinting = displayed !== mode;
    node.dataset.hintMode = displayed;
    node.dataset.hint = hinting ? "true" : "false";
    if (hinting) node.dataset.preview = displayed;
    else delete node.dataset.preview;
    if (glyph.current) glyph.current.textContent = MODES[displayed].glyph;

    // A held modifier is a momentary override, so a click during one changes nothing
    // (see the guard below). The label has to say so, or it would keep promising the
    // switch that the click no longer performs.
    // A key whose value is already stored steps back to the one it displaced, so a
    // held key always shows something other than the stored mode: the label can say
    // "release to return" without a case for "you are already there".
    const key = heldKey(held.current);
    const label = key
      ? `${shortLabel(displayed)} while ${key} is held. Release ${key} to return to ${shortLabel(mode)}`
      : `${MODES[mode].label}. ${switchLabel(mode)}`;
    node.title = label;
    node.setAttribute("aria-label", label);
  }, [mode]);

  // A commit restores the stored class and glyph from JSX, so the hint is
  // re-applied before the browser paints — still without a state update of its
  // own, and with no flash of the stored mode while a gesture is in flight.
  useLayoutEffect(() => {
    paintHint();
  });

  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      // Typing is not a gesture: holding shift for a capital letter must not
      // repaint the tool.
      const next = isTextEntry(event) ? NO_MODIFIERS : modifiersOf(event);
      const current = held.current;
      if (next.shift === current.shift && next.ctrl === current.ctrl && next.alt === current.alt) {
        return;
      }
      held.current = next;
      paintHint();
    };
    const release = () => {
      if (held.current === NO_MODIFIERS) return;
      held.current = NO_MODIFIERS;
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

  // During a run the bar *is* the mode control — it carries the count and the verbs
  // that would otherwise be spread across the mode button and the widget. It is
  // mounted beside this control, not inside the pill, because it is a panel and the
  // pill is a column of segments (see `PlacementRunBar`).
  if (run && engine) return null;

  // One button that walks a four-state cycle rather than a segmented control:
  // the four are one tool with four readings, and four buttons would imply four
  // independent tools — which is exactly the mistake the second arm would make.
  return (
    <button
      ref={button}
      type="button"
      className="link-mode-control"
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
        // A held modifier is a momentary override: the canvas is already behaving as
        // the previewed mode, and releasing the key is what ends it. Committing on a
        // click too would have two endings for one gesture — and the stored mode it
        // would cycle from is not the one on screen, so the click would appear to
        // pick an unrelated mode. Refuse, and let go of the key instead.
        if (isHeld(held.current)) return;
        // Changing mode must also disarm whatever the old mode armed: an origin
        // from a fan means something different once the mode is thread.
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
