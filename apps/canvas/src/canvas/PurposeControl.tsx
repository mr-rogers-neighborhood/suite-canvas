import { useUiStore } from "../store/useUiStore";
import { previewedValue } from "./modifierPreview";
import { type CanvasPurpose, choosablePurposes, nextPurpose } from "./purpose";
import { useModifierState } from "./useModifierState";

/**
 * The purpose family ([ADR-0064](../../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)):
 * what the canvas is *for*, as opposed to what the next click does. One glyph per
 * purpose, and the glyph carries the state: a ring that differed only by hue
 * would disappear in a monochrome screenshot and for a reader who cannot tell the
 * hues apart.
 *
 * `run` is a queue, not a transport control. A play triangle beside a record dot
 * reads as media playback — "play this tour back" — and a run is the opposite of
 * playback: a list of cards being placed one click at a time (ADR-0064 §11).
 */
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
  // Not a mode the reader picks, so it is named as a state rather than offered.
  present: {
    label: "Presenting a tour",
    glyph: "\u25a3",
  },
};

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
 * The modifiers preview the same way the link tool's do ([ADR-0066](../../../docs/decisions/0066-one-modifier-vocabulary-and-a-purpose-that-explains.md)):
 * shift points at `run`, ctrl at `record`, and holding one both repaints the
 * button and changes what a click commits, so the label never lies about it. Alt
 * is reserved: a three-value family has no fourth, and the slot belongs to
 * `explain` when it lands.
 */
export function PurposeControl() {
  const purpose = useUiStore((state) => state.purpose);
  const setPurpose = useUiStore((state) => state.setPurpose);
  const modifiers = useModifierState();

  // What a click would choose: the previewed value when a modifier points at one,
  // otherwise the next value in the cycle.
  const previewed =
    purpose === "present" ? null : previewedValue<CanvasPurpose>(choosablePurposes, modifiers);
  const target = previewed ?? nextPurpose(purpose);

  const current = PURPOSES[purpose];
  const label = `${current.label}. ${switchLabel(purpose, target)}`;
  // The previewed value is shown, not stored: the ring stays on what the reader is
  // actually doing, and the glyph says what the modifier would make it.
  const shown = PURPOSES[previewed ?? purpose];

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
      onClick={() => setPurpose(target)}
    >
      <span aria-hidden="true">{shown.glyph}</span>
    </button>
  );
}
