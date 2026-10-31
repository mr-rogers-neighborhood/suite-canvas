import {
  isDeadTarget,
  primaryTarget,
  type Target,
  type TourStep,
  type TourStepViewport,
  tourSteps,
} from "@suite/graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { targetElement } from "../canvas/targetElement";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { completeTour, targetExistence, useLoroVersion } from "./tour";

/**
 * Where a tour's playing surface is mounted.
 *
 * The overlay is chrome over the canvas, not part of it: it mounts beside the
 * inspector in the app shell and measures what to spotlight from the DOM (cards
 * carry `data-node-id`, sections `data-testid="section-region-<id>"`) rather than
 * reaching into React Flow. That is what keeps the tour feature out of
 * `CanvasBoard.tsx` (ADR-0058).
 *
 * Until a tour is presenting this renders nothing at all, so the shell is
 * unchanged for every other surface.
 */
export function TourOverlayHost() {
  const tour = useUiStore((state) => state.tour);
  if (!tour?.presenting) return null;

  // Keyed by tutorial so a new tour starts from a new "where I was" camera.
  return <TourOverlay key={tour.tutorialId} tutorialId={tour.tutorialId} />;
}

/** A box in overlay coordinates, measured from the DOM. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const SAME_BOX = 0.5;

/**
 * The column the canvas widget stack occupies on the left (purpose control at
 * `left: 15px`, gesture control and zoom pill above it). Anything anchored to the
 * bottom-left corner starts to its right.
 */
const CAPTION_GUTTER = 56;

function sameBox(left: Box | null, right: Box | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    Math.abs(left.left - right.left) < SAME_BOX &&
    Math.abs(left.top - right.top) < SAME_BOX &&
    Math.abs(left.width - right.width) < SAME_BOX &&
    Math.abs(left.height - right.height) < SAME_BOX
  );
}

/**
 * Moves the camera to a step's stored viewport through the existing request
 * channel (ADR-0058);
 * a step on another board activates it with the same request, so a cross-board
 * stop needs no second camera API.
 */
function requestViewport(boardId: string, viewport: TourStepViewport): void {
  const state = useUiStore.getState();
  if (state.activeBoardId !== boardId) {
    state.activateBoard(boardId, { viewport });
    return;
  }
  // The store's own one-shot channel, written directly because a tour step is
  // not a board switch: no history entry, no tab, no selection reset.
  useUiStore.setState({
    viewportRequest: { boardId, viewport, nonce: Date.now() },
  });
}

/** The board a target lives on, so a cross-board stop knows where to fly. */
function boardOfTarget(
  workspace: ReturnType<typeof useCanvasStore.getState>["workspace"],
  target: Target | null,
): string | null {
  if (!target) return null;
  switch (target.kind) {
    case "board":
      return target.id;
    case "section":
      return workspace.getSection(target.id)?.boardId ?? null;
    case "link":
      return workspace.getEdge(target.id)?.boardId ?? null;
    case "card":
      return (
        workspace.listPlacements().find((placement) => placement.cardId === target.id)?.boardId ??
        null
      );
    case "ui":
      // A region of the shell is on whatever board is in front of the reader, so a step
      // naming one never needs a board switch.
      return null;
  }
}

/**
 * The reader's view of a tour: spotlight, dimming, camera, caption and
 * controls. Works with no inspector open, which is what makes a tour shareable
 * (ADR-0058 §3).
 */
function TourOverlay({ tutorialId }: { tutorialId: string }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const version = useLoroVersion(workspace.doc);
  const setTourStep = useUiStore((state) => state.setTourStep);
  const closeTour = useUiStore((state) => state.closeTour);
  const stepIndex = useUiStore((state) => state.tour?.stepIndex ?? 0);

  const steps: TourStep[] = useMemo(() => {
    // Re-read the body after any write to it: `version` is the signal, and the
    // step list is a pure read of the containers it guards.
    void version;
    return tourSteps(workspace, tutorialId);
  }, [workspace, tutorialId, version]);
  const count = steps.length;
  const index = count === 0 ? 0 : Math.max(0, Math.min(stepIndex, count - 1));
  const step = steps[index] ?? null;
  const primary = step ? primaryTarget(step) : null;
  const exists = useMemo(() => targetExistence(workspace), [workspace]);
  // The primary is what a single-target consumer reads (ADR-0058 §5), so it is
  // also the target whose disappearance the tombstone speaks about.
  const dead = primary ? isDeadTarget(primary, exists) : false;

  const host = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  // Where the tour started, so Escape puts the reader back where they were.
  const startCamera = useRef<{
    boardId: string | null;
    viewport: { x: number; y: number; zoom: number } | null;
  }>({
    boardId: useUiStore.getState().activeBoardId,
    viewport: (() => {
      const state = useUiStore.getState();
      return state.activeBoardId ? (state.boardViewports[state.activeBoardId] ?? null) : null;
    })(),
  });

  const exit = useCallback(() => {
    const { boardId, viewport } = startCamera.current;
    if (boardId && viewport) requestViewport(boardId, viewport);
    closeTour();
  }, [closeTour]);

  const next = useCallback(() => {
    if (index + 1 >= count) {
      // The last step is passed: record it and leave (ADR-0054 §9).
      completeTour(tutorialId);
      return;
    }
    setTourStep(index + 1);
  }, [count, index, setTourStep, tutorialId]);

  // The camera follows the step, not the reading position: a caption edit must
  // not fly away from what the author is looking at.
  const viewport = step?.viewport ?? null;
  const targetBoard = useMemo(() => boardOfTarget(workspace, primary), [workspace, primary]);
  useEffect(() => {
    // A new step re-applies the camera even when it stores the same frame.
    void index;
    if (!viewport || !targetBoard) return;
    requestViewport(targetBoard, viewport);
  }, [viewport, targetBoard, index]);

  // Measure every frame while a step shows: the camera animates and the reader
  // may pan, and the ring has to stay on the thing it names.
  useEffect(() => {
    // A deleted target and a moved step both restart the measurement.
    void index;
    void dead;
    const element = targetElement(primary);
    if (!element) {
      setBox(null);
      return;
    }
    let frame = 0;
    let stopped = false;
    const measure = () => {
      if (stopped) return;
      const hostRect = host.current?.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      if (hostRect) {
        const next = {
          left: rect.left - hostRect.left,
          top: rect.top - hostRect.top,
          width: rect.width,
          height: rect.height,
        };
        setBox((current) => (sameBox(current, next) ? current : next));
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [primary, index, dead]);

  useEscapeLayer(exit);

  // A presentation owns the keyboard. Without this, focus can stay in a card
  // editor behind the overlay, and Escape is read as "clear the field" instead
  // of "leave the tour".
  useEffect(() => {
    host.current?.focus();
  }, []);

  const clickToAdvance = step?.advance === "click" && !dead;
  const captionTop = box ? box.top + box.height + 12 : null;
  const captionStyle =
    box && captionTop !== null
      ? {
          // Never left of the widget gutter: the purpose control sits there and
          // it is the way out of a presentation, so the caption must not cover it.
          left: Math.max(CAPTION_GUTTER, Math.min(box.left, window.innerWidth - 360)),
          top: Math.min(captionTop, window.innerHeight - 180),
        }
      : undefined;

  return (
    <section
      className="tour-overlay"
      data-testid="tour-overlay"
      data-handbook-region="tour-overlay"
      data-tutorial-id={tutorialId}
      data-step={index}
      ref={host}
      tabIndex={-1}
      aria-label="Tour"
    >
      <div className="tour-overlay__dim" aria-hidden="true" />
      {box && !dead ? (
        clickToAdvance ? (
          // An `advance: "click"` step waits for the reader to press the thing
          // it points at, so the ring itself is the button.
          <button
            type="button"
            className="tour-overlay__spotlight is-clickable"
            data-testid="tour-spotlight"
            data-click-advance="true"
            aria-label="Highlighted target: click to continue"
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            }}
            onClick={next}
          />
        ) : (
          <div
            className="tour-overlay__spotlight"
            data-testid="tour-spotlight"
            aria-hidden="true"
            style={{
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
            }}
          />
        )
      ) : null}

      <div
        className="tour-overlay__caption"
        data-testid="tour-caption"
        style={captionStyle}
        role="dialog"
        aria-label="Tour step"
      >
        <p className="tour-overlay__step" data-testid="tour-step-index">
          Step {index + 1} of {count}
        </p>
        {count === 0 ? (
          <p className="tour-overlay__tombstone" data-testid="tour-tombstone">
            This tour has no steps yet.
          </p>
        ) : dead ? (
          <p className="tour-overlay__tombstone" data-testid="tour-tombstone">
            This was removed — the tour remembers the view it pointed at.
          </p>
        ) : null}
        {step?.caption ? (
          <p className="tour-overlay__text" data-testid="tour-caption-text">
            {step.caption}
          </p>
        ) : null}
        {clickToAdvance ? (
          <p className="tour-overlay__hint" data-testid="tour-click-hint">
            Click the highlighted thing to continue.
          </p>
        ) : null}
        <div className="tour-overlay__bar">
          <button
            type="button"
            className="tour-overlay__control"
            data-testid="tour-prev"
            onClick={() => setTourStep(index - 1)}
            disabled={index === 0}
          >
            Back
          </button>
          <button
            type="button"
            className="tour-overlay__control"
            data-testid="tour-next"
            onClick={next}
          >
            {index + 1 >= count ? "Finish" : "Next"}
          </button>
          <button
            type="button"
            className="tour-overlay__control"
            data-testid="tour-exit"
            onClick={exit}
          >
            Exit
          </button>
        </div>
      </div>
    </section>
  );
}
