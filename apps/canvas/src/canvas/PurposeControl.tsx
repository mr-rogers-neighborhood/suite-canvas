import { useUiStore } from "../store/useUiStore";
import { heldKey, isHeld, previewedValue } from "./modifierPreview";
import {
  type CanvasPurpose,
  nextPurpose,
  type PreviewablePurpose,
  previewablePurposes,
} from "./purpose";
import { useModifierState } from "./useModifierState";

/**
 * The purpose family (ADR-0064):
 * what the canvas is *for*, as opposed to what the next click does. One glyph per
 * purpose, and the glyph carries the state: a ring that differed only by hue
 * would disappear in a monochrome screenshot and for a reader who cannot tell the
 * hues apart.
 *
 * `run` is a queue, not a transport control. A play triangle beside a record dot
 * reads as media playback — "play this tour back" — and a run is the opposite of
 * playback: a list of cards being placed one click at a time (ADR-0064 §11).
 */
/**
 * Display for every value the control can show, including the one that is only ever a
 * previewed state (`present`) — the glyph and label a value carries do not depend on
 * whether it can be clicked.
 */
const PREVIEW_DISPLAY: Record<CanvasPurpose, { label: string; glyph: string }> = {
  explore: { label: "Explore mode: edit the canvas", glyph: "\u25cb" },
  run: { label: "Run mode: place a sequence of cards", glyph: "\u2261" },
  record: { label: "Record mode: capture steps into a tour", glyph: "\u25cf" },
  explain: { label: "Explain mode: gather this selection into a context", glyph: "\u25c8" },
  present: { label: "Presenting a tour", glyph: "\u25a3" },
};

const PURPOSES: Record<CanvasPurpose, { label: string; glyph: string }> = {
  explore: {
    label: "Explore mode: edit the canvas",
    glyph: "\u25cb",
  },
  run: {
    label: "Run mode: place a sequence of cards",
    glyph: "\u2261",
  },
  record: {
    label: "Record mode: capture steps into a tour",
    glyph: "\u25cf",
  },
  explain: {
    label: "Explain mode: gather this selection into a context",
    glyph: "\u25c8",
  },
  // Not a mode the reader picks, so it is named as a state rather than offered.
  present: {
    label: "Presenting a tour",
    glyph: "\u25a3",
  },
};

/** "Record mode", the name without the clause after the colon, for a label that embeds it. */
function shortPurposeLabel(purpose: CanvasPurpose | "explain"): string {
  return PREVIEW_DISPLAY[purpose].label.split(":")[0] ?? PREVIEW_DISPLAY[purpose].label;
}

/** "Switch to record mode: capture steps into a tour". */
function switchLabel(purpose: CanvasPurpose, target: CanvasPurpose): string {
  // Presenting is a tour's state, so leaving it is not "switching mode": it is
  // stepping out of the takeover, which is the only thing this control can do here.
  if (purpose === "present") return "Stop presenting and return to the canvas";
  const next = PURPOSES[target];
  return `Switch to ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}`;
}

/**
 * The purpose control, stacked with the zoom and gesture controls.
 *
 * It cycles rather than segments, for the same reason the gesture control does:
 * the values are one question, and buttons side by side would offer "exploring
 * and recording at once" — the one thing the two axes cannot mean.
 *
 * It is the pill's bottom segment rather than a separate button: one column with
 * the purpose at the floor and the link mode above it, sharing the pill's corners
 * so the stack reads as one object.
 *
 * `present` is displayed but never cycled into — a presentation is scoped to a
 * tour, which is the only thing that can start one (ADR-0064 §11). From there this
 * control is the exit.
 *
 * The modifiers preview the same way the link tool's do (ADR-0066):
 * shift points at `run`, ctrl at `record`, alt at `explain`. A held key repaints the
 * button and refuses the click — the key *is* the override, and releasing ends it — so
 * the button never promises a switch it would not perform.
 */
export function PurposeControl() {
  const purpose = useUiStore((state) => state.purpose);
  const setPurpose = useUiStore((state) => state.setPurpose);
  const modifiers = useModifierState();

  // What a click would choose: the previewed value when a modifier points at one,
  // otherwise the next value in the cycle.
  const previewed =
    purpose === "present"
      ? null
      : previewedValue<PreviewablePurpose>(previewablePurposes, modifiers, purpose);
  const target = previewed ?? nextPurpose(purpose);

  /**
   * A held modifier is a momentary override, and a click during one changes nothing
   * (the guard below). It is the same rule as the link tool's, because the two axes
   * share one modifier vocabulary (ADR-0066) and a gesture cannot mean two things.
   */
  const held = isHeld(modifiers) ? heldKey(modifiers) : null;

  const current = PURPOSES[purpose];
  const label = held
    ? `${shortPurposeLabel(previewed ?? purpose)} while ${held} is held. Release ${held} to return to ${shortPurposeLabel(purpose)}`
    : `${current.label}. ${switchLabel(purpose, target)}`;
  // The previewed value is shown, not stored: the ring stays on what the reader is
  // actually doing, and the glyph says what the modifier would make it.
  const shown = PREVIEW_DISPLAY[previewed ?? purpose];

  return (
    <button
      type="button"
      className="purpose-control"
      aria-pressed={purpose !== "explore"}
      aria-label={label}
      title={label}
      data-testid="purpose-toggle"
      data-purpose={purpose}
      data-preview={previewed ?? undefined}
      // The canvas claims pointerdown for panning and selection and prevents the
      // default, which suppresses the click a nested control would otherwise get.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={() => {
        // Held, the preview is momentary and the key release is what ends it.
        if (held) return;
        setPurpose(target);
      }}
    >
      <span aria-hidden="true">{shown.glyph}</span>
    </button>
  );
}
