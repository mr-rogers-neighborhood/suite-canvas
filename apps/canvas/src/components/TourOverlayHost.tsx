import { useUiStore } from "../store/useUiStore";

/**
 * Where a tour's playing surface is mounted.
 *
 * The overlay is chrome over the canvas, not part of it: it mounts beside the
 * inspector in the app shell and measures what to spotlight from the DOM (cards
 * carry `data-node-id`, sections `data-testid="section-region-<id>"`) rather than
 * reaching into React Flow. That is what keeps the tour feature out of
 * `CanvasBoard.tsx` ([ADR-0058](../../docs/decisions/0058-a-tour-is-one-document-on-three-surfaces.md)).
 *
 * Until a tour is presenting this renders nothing at all, so the shell is
 * unchanged for every other surface.
 */
export function TourOverlayHost() {
  const tour = useUiStore((state) => state.tour);
  if (!tour?.presenting) return null;

  return <TourOverlay tutorialId={tour.tutorialId} stepIndex={tour.stepIndex} />;
}

/**
 * The reader's view of a tour: spotlight, dimming, caption and controls.
 *
 * The seam: geometry, the caption editor and the transport controls arrive with
 * the tours lane. A minimal, honest placeholder is used until then, so nothing
 * can silently render a broken overlay.
 */
function TourOverlay({ tutorialId, stepIndex }: { tutorialId: string; stepIndex: number }) {
  const closeTour = useUiStore((state) => state.closeTour);
  const setTourStep = useUiStore((state) => state.setTourStep);

  return (
    <section
      className="tour-overlay"
      data-testid="tour-overlay"
      data-tutorial-id={tutorialId}
      data-step={stepIndex}
      aria-label="Tour"
    >
      <div className="tour-overlay__bar">
        <span className="tour-overlay__step" data-testid="tour-step-index">
          Step {stepIndex + 1}
        </span>
        <button
          type="button"
          className="tour-overlay__control"
          data-testid="tour-prev"
          onClick={() => setTourStep(stepIndex - 1)}
          disabled={stepIndex === 0}
        >
          Back
        </button>
        <button
          type="button"
          className="tour-overlay__control"
          data-testid="tour-next"
          onClick={() => setTourStep(stepIndex + 1)}
        >
          Next
        </button>
        <button
          type="button"
          className="tour-overlay__control"
          data-testid="tour-exit"
          onClick={closeTour}
        >
          Exit
        </button>
      </div>
    </section>
  );
}
