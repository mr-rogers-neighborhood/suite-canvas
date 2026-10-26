import { useUiStore } from "../store/useUiStore";
import { type CanvasPurpose, nextPurpose } from "./purpose";

/**
 * The purpose family ([ADR-0064](../../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)):
 * what the canvas is *for*, as opposed to what the next click does. One glyph per
 * purpose, and the glyph carries the state: a ring that differed only by hue
 * would disappear in a monochrome screenshot and for a reader who cannot tell the
 * hues apart.
 */
const PURPOSES: Record<CanvasPurpose, { label: string; glyph: string }> = {
  explore: {
    label: "Explore mode: edit the canvas",
    glyph: "\u25cb",
  },
  run: {
    label: "Run mode: place a sequence of cards",
    glyph: "\u25b6",
  },
  record: {
    label: "Record mode: capture steps into a tour",
    glyph: "\u25cf",
  },
  present: {
    label: "Present mode: show the tour",
    glyph: "\u25a3",
  },
};

/** "Switch to record mode: capture steps into a tour". */
function switchLabel(purpose: CanvasPurpose): string {
  const target = nextPurpose(purpose);
  return `Switch to ${PURPOSES[target].label.charAt(0).toLowerCase()}${PURPOSES[target].label.slice(1)}`;
}

interface PresentState {
  /** `present` is the next value and there is nothing to show, so it is refused. */
  refused: boolean;
  /** What the title says about the missing tour, or null when there is nothing to say. */
  note: string | null;
}

/**
 * What the control can say about `present`, which is the one value the store will
 * refuse (`setPurpose` needs a tour).
 *
 * A refused value is passed over rather than stalled on: a cycle that could not
 * leave `record` would be the purpose equivalent of a run with no stop
 * (ADR-0064 §10). A `present` whose tour has ended is not refused — it is the
 * value the reader is already on, and leaving it is the only move left.
 */
function presentState(purpose: CanvasPurpose, hasTour: boolean): PresentState {
  if (hasTour) return { refused: false, note: null };
  if (purpose === "present") {
    return { refused: false, note: "The tour has ended — a click returns to explore." };
  }
  if (nextPurpose(purpose) === "present") {
    return {
      refused: true,
      note: "Nothing to present yet — open a tutorial's Steps panel to make a tour. A click returns to explore.",
    };
  }
  return { refused: false, note: null };
}

/**
 * The purpose control, stacked with the zoom and gesture controls.
 *
 * It cycles rather than segments, for the same reason the gesture control does:
 * the four values are one question with four readings, and four buttons would
 * offer "exploring and recording at once" — the one thing the two axes cannot
 * mean.
 */
export function PurposeControl() {
  const purpose = useUiStore((state) => state.purpose);
  const setPurpose = useUiStore((state) => state.setPurpose);
  const hasTour = useUiStore((state) => state.tour !== null);

  const current = PURPOSES[purpose];
  const target = nextPurpose(purpose);
  const present = presentState(purpose, hasTour);
  const destination = present.refused ? nextPurpose(target) : target;
  const label = `${current.label}. ${switchLabel(purpose)}`;
  const title = present.note === null ? label : `${label} ${present.note}`;

  return (
    <button
      type="button"
      className="purpose-control"
      aria-pressed={purpose !== "explore"}
      aria-disabled={present.refused || undefined}
      aria-label={label}
      title={title}
      data-testid="purpose-toggle"
      data-purpose={purpose}
      // The canvas claims pointerdown for panning and selection and prevents the
      // default, which suppresses the click a nested control would otherwise get.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={() => setPurpose(destination)}
    >
      <span aria-hidden="true">{current.glyph}</span>
    </button>
  );
}
