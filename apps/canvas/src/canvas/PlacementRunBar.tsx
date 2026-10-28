import { MODES, shortLabel } from "./links/ModeControl";
import { usePlacementRunStore } from "./placementRun";
import type { PlacementEngine } from "./usePlacementEngine";

/**
 * The bar that steers a placement run (ADR-0063
 * third amendment).
 *
 * It used to be rendered *by* the mode control, in the mode control's own slot, with its own
 * border, radius and shadow — a fourth owner of a pill that already had three. It is not a
 * segment: it is a panel with a count and three verbs, and it is wider than the pill will
 * ever be. So it floats free above the pill and says what a panel says.
 *
 * While it is up the mode segment is hidden rather than duplicated: the bar *is* the mode
 * control for the duration, because the shape that decided where the last card went is
 * the shape that decides the next one. It reads the run's own shape rather than the live
 * mode, so a run cannot be steered by a modifier pressed for something else.
 */
export function PlacementRunBar({ engine }: { engine: PlacementEngine }) {
  const run = usePlacementRunStore((state) => state.run);
  const skip = usePlacementRunStore((state) => state.skip);
  const finish = usePlacementRunStore((state) => state.finish);

  if (!run) return null;
  const mode = run.shape;
  const total = run.placed.length + run.queue.length;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a panel of verbs over the canvas, not a form; a fieldset brings form semantics and layout defaults to an overlay
    <div
      className="placement-run"
      role="group"
      aria-label={`${shortLabel(mode)} run`}
      data-testid="placement-run"
      data-mode={mode}
    >
      {/* The pill's mode segment withdraws during a run, so this is the only place the
          value shows. It is the same glyph, painted from the same tokens. */}
      <span className="placement-run__mode" aria-hidden="true">
        {MODES[mode].glyph}
      </span>
      <span className="placement-run__count" data-testid="placement-run-count">
        {`${run.placed.length} / ${total}`}
      </span>
      <button
        type="button"
        className="placement-run__action"
        data-testid="placement-run-place-all"
        title="Place the rest now, as one undo step"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => engine.placeAll()}
      >
        Place all
      </button>
      <button
        type="button"
        className="placement-run__action"
        data-testid="placement-run-skip"
        title="Skip this one and take the next"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          skip();
          // Skipping is a step: the engine places whatever the queue now heads with,
          // so the run never stalls waiting for another gesture.
          engine.step();
        }}
      >
        Skip
      </button>
      <button
        type="button"
        className="placement-run__action"
        data-testid="placement-run-stop"
        title="Stop placing (Escape)"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => finish()}
      >
        Stop
      </button>
    </div>
  );
}
