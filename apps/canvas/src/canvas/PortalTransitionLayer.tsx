import { getViewportForBounds, useReactFlow, useStore } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { type PortalEntryRequest, useUiStore, type ViewportState } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { BoardMiniature } from "./BoardMiniature";
import { prefersReducedMotion } from "./localEasing";
import { type BoardMiniatureModel, boardBounds, boardMiniature } from "./portalMiniature";

/** Length of the camera trick. Short enough to feel like a gesture, not a page load. */
export const PORTAL_TRANSITION_MS = 320;
/** Room left around the target board once the overlay has grown to the canvas. */
const FIT_PADDING = 0.06;
/** Never zoom past the scale a single card gets when focused. */
const FIT_MAX_ZOOM = 1.4;

interface PreparedEntry {
  request: PortalEntryRequest;
  boardName: string;
  model: BoardMiniatureModel;
  start: { left: number; top: number; width: number; height: number };
  pane: { width: number; height: number };
  viewport: ViewportState | null;
}

/**
 * The camera trick behind a portal: draw the target board's miniature into the
 * portal's screen rectangle, grow it to the canvas, then swap the board
 * underneath. No second React Flow instance, no page navigation and no frame
 * where the canvas is blank.
 */
export function PortalTransitionLayer() {
  const snapshot = useWorkspaceSnapshot();
  const request = useUiStore((state) => state.portalEntry);
  const clearPortalEntry = useUiStore((state) => state.clearPortalEntry);
  const activateBoard = useUiStore((state) => state.activateBoard);
  const { setViewport } = useReactFlow();
  const minZoom = useStore((state) => state.minZoom);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [prepared, setPrepared] = useState<PreparedEntry | null>(null);
  // The snapshot at request time: the animation must not restart because a peer
  // happened to edit a card while the overlay was in flight.
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  });

  useEffect(() => {
    if (!request) {
      setPrepared(null);
      return;
    }
    const layer = layerRef.current;
    if (!layer) {
      clearPortalEntry();
      return;
    }
    const current = snapshotRef.current;
    const board = current.boards.find((entry) => entry.id === request.targetBoardId);
    if (!board) {
      clearPortalEntry();
      return;
    }

    const paneRect = layer.getBoundingClientRect();
    const pane = { width: paneRect.width, height: paneRect.height };
    if (pane.width === 0 || pane.height === 0) {
      clearPortalEntry();
      return;
    }

    const placements = current.placements.filter(
      (entry) => entry.boardId === request.targetBoardId,
    );
    const sections = current.sections.filter((entry) => entry.boardId === request.targetBoardId);
    const bounds = boardBounds(sections, placements);
    const start = {
      left: clamp(request.rect.left - paneRect.left, 0, pane.width),
      top: clamp(request.rect.top - paneRect.top, 0, pane.height),
      width: Math.min(request.rect.width, pane.width),
      height: Math.min(request.rect.height, pane.height),
    };

    setPrepared({
      request,
      boardName: board.name,
      model: boardMiniature(sections, placements),
      start,
      pane,
      viewport: bounds
        ? getViewportForBounds(bounds, pane.width, pane.height, minZoom, FIT_MAX_ZOOM, FIT_PADDING)
        : null,
    });
  }, [request, clearPortalEntry, minZoom]);

  useEffect(() => {
    if (!prepared) return;
    const box = boxRef.current;
    const { request: entry, viewport } = prepared;

    // One board switch per gesture, and the camera lands before the overlay is
    // removed so the real board replaces the drawing without a flash.
    const finish = () => {
      activateBoard(entry.targetBoardId, { via: "portal", viewport: viewport ?? null });
      if (viewport) void setViewport(viewport, { duration: 0 });
      // Two frames: the first paints the target board under the overlay, the
      // second removes it once that paint is on screen.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => clearPortalEntry());
      });
    };

    if (!box || typeof box.animate !== "function" || prefersReducedMotion()) {
      // Reduced motion, and environments without the Web Animations API
      // (jsdom, old browsers), jump straight to the target board.
      finish();
      return;
    }

    const animation = box.animate(
      [
        {
          left: `${prepared.start.left}px`,
          top: `${prepared.start.top}px`,
          width: `${prepared.start.width}px`,
          height: `${prepared.start.height}px`,
          borderRadius: "12px",
        },
        {
          left: "0px",
          top: "0px",
          width: `${prepared.pane.width}px`,
          height: `${prepared.pane.height}px`,
          borderRadius: "0px",
        },
      ],
      {
        duration: PORTAL_TRANSITION_MS,
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        fill: "forwards",
      },
    );

    let cancelled = false;
    void animation.finished
      .then(() => {
        if (!cancelled) finish();
      })
      .catch(() => {
        // Cancelled by unmount or a newer entry; the newer one owns the switch.
      });
    return () => {
      cancelled = true;
      animation.cancel();
    };
  }, [prepared, activateBoard, clearPortalEntry, setViewport]);

  // The measuring wrapper is mounted at rest: the first request has to measure
  // the canvas before it can draw the overlay at the portal's rectangle.
  return (
    <div ref={layerRef} className="portal-transition-layer" aria-hidden="true">
      {prepared ? (
        <div className="portal-transition" data-testid="portal-transition" data-active="true">
          <div className="portal-transition__scrim" />
          <div
            ref={boxRef}
            className="portal-transition__box"
            data-testid="portal-transition-box"
            data-target-board={prepared.request.targetBoardId}
            style={{
              left: prepared.start.left,
              top: prepared.start.top,
              width: prepared.start.width,
              height: prepared.start.height,
            }}
          >
            <BoardMiniature model={prepared.model} label={`${prepared.boardName} miniature`} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
