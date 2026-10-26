import type { Rect } from "@suite/graph";
import { getViewportForBounds } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import { portalTargetId } from "../../cards/portal";
import { useUiStore } from "../../store/useUiStore";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardUi } from "./useBoardUi";

/** How long a focus request waits for React Flow to register the card's node. */
const FOCUS_POLL_TIMEOUT_MS = 1500;
/** Card box assumed until React Flow has measured it. */
const FOCUS_FALLBACK_SIZE = { width: 224, height: 160 };
const FOCUS_DURATION_MS = 300;
/** A focused card or section should not fill the screen. */
const FOCUS_MAX_ZOOM = 1.2;
/**
 * The most a fit may magnify. Fitting frames what is on the board; it does not
 * zoom in to fill the screen with two cards, which reads as the board having
 * grown and pushes cards under the inspector drawer.
 */
const FIT_MAX_ZOOM = 1;
/**
 * Share of the canvas a portal must cover, while zooming in, before the camera
 * takes it as an intent to enter. A portal "filling most of the viewport" is a
 * doorway; brushing past one is not.
 */
const PORTAL_ZOOM_COVERAGE = 0.82;
/** Zooming out by this share of the gesture's starting zoom is a step back. */
const PORTAL_ZOOM_BACK_RATIO = 0.5;

/**
 * The camera: restoring a board's stored viewport, revealing what a surface
 * focused, stepping through a portal, and reading the two zoom gestures that
 * enter and leave a board.
 */
export function useBoardCamera(
  ui: ReturnType<typeof useBoardUi>,
  input: { projection: ReturnType<typeof useBoardProjection> },
) {
  const {
    activeBoardId,
    snapshot,
    store,
    focusTarget,
    clearFocusTarget,
    setActiveBoardId,
    setViewport,
    getViewport,
    fitView,
    viewportRequest,
    clearViewportRequest,
    recordBoardViewport,
    goBackBoard,
    requestPortalEntry,
    portalOpenRequest,
    clearPortalOpenRequest,
  } = ui;
  const { projection } = input;
  const { cardsById } = projection;

  // Reveal a card or section a surface asked for. A request can land before the
  // board has rendered its nodes (switching boards rebuilds them on the next
  // snapshot pass), so card targets poll until React Flow registers the node.
  useEffect(() => {
    if (!focusTarget) return;

    if (focusTarget.boardId !== activeBoardId) {
      setActiveBoardId(focusTarget.boardId);
      return;
    }

    const reveal = (rect: Rect, padding: number) => {
      const { width, height, minZoom } = store.getState();
      // `fitBounds` cannot cap the zoom, and a single card should not fill the screen.
      const viewport = getViewportForBounds(rect, width, height, minZoom, FOCUS_MAX_ZOOM, padding);
      void setViewport(viewport, { duration: FOCUS_DURATION_MS });
    };

    if (focusTarget.kind === "section") {
      const section = snapshot.sections.find((entry) => entry.id === focusTarget.id);
      if (!section) {
        clearFocusTarget();
        return;
      }
      reveal({ x: section.x, y: section.y, width: section.width, height: section.height }, 0.12);
      clearFocusTarget();
      return;
    }

    let frame = 0;
    const deadline = performance.now() + FOCUS_POLL_TIMEOUT_MS;
    const settle = () => {
      const node = store.getState().nodeLookup.get(focusTarget.id);
      if (!node) {
        if (performance.now() > deadline) {
          clearFocusTarget();
          return;
        }
        frame = requestAnimationFrame(settle);
        return;
      }
      const position = node.internals.positionAbsolute;
      reveal(
        {
          x: position.x,
          y: position.y,
          width: node.measured.width ?? FOCUS_FALLBACK_SIZE.width,
          height: node.measured.height ?? FOCUS_FALLBACK_SIZE.height,
        },
        0.6,
      );
      clearFocusTarget();
    };
    settle();

    return () => cancelAnimationFrame(frame);
  }, [
    activeBoardId,
    clearFocusTarget,
    focusTarget,
    setActiveBoardId,
    setViewport,
    snapshot.sections,
    store,
  ]);

  /** Screen rectangle of a node, used to start the camera trick at the card. */
  const nodeScreenRect = useCallback(
    (nodeId: string) => {
      const node = store.getState().nodeLookup.get(nodeId);
      const pane = document.querySelector<HTMLElement>('[data-testid="canvas-board"]');
      if (!node || !pane) return null;
      const rect = pane.getBoundingClientRect();
      const [tx, ty, zoom] = store.getState().transform;
      const position = node.internals.positionAbsolute;
      const width = node.measured?.width ?? FOCUS_FALLBACK_SIZE.width;
      const height = node.measured?.height ?? FOCUS_FALLBACK_SIZE.height;
      return {
        left: rect.left + position.x * zoom + tx,
        top: rect.top + position.y * zoom + ty,
        width: width * zoom,
        height: height * zoom,
      };
    },
    [store],
  );

  const enterPortal = useCallback(
    (nodeId: string, targetBoardId: string) => {
      const rect = nodeScreenRect(nodeId);
      if (!rect) return;
      requestPortalEntry({ nodeId, targetBoardId, rect });
    },
    [nodeScreenRect, requestPortalEntry],
  );

  // A surface (the container panel) asked to step through a portal. The camera
  // owns the doorway — it needs the node's screen rect to fly from — so the
  // request is fulfilled here, where the node's geometry is known.
  useEffect(() => {
    if (!portalOpenRequest) return;
    enterPortal(portalOpenRequest.cardId, portalOpenRequest.boardId);
    clearPortalOpenRequest();
  }, [portalOpenRequest, enterPortal, clearPortalOpenRequest]);

  /** Orderly arrival on a board whose stored camera should be restored. */
  useEffect(() => {
    if (!viewportRequest || viewportRequest.boardId !== activeBoardId) return;
    const request = viewportRequest;
    // The board's nodes paint on the render this effect follows; one frame
    // later React Flow has the size it needs to fit them. The request is
    // cleared after the move, not before: clearing re-renders, and a cleanup
    // on that render would cancel the frame this effect just scheduled.
    const frame = requestAnimationFrame(() => {
      if (request.viewport) {
        void setViewport(request.viewport, { duration: 0 });
      } else {
        void fitView({ padding: 0.2, duration: 0, maxZoom: FIT_MAX_ZOOM });
      }
      clearViewportRequest();
    });
    return () => cancelAnimationFrame(frame);
  }, [viewportRequest, activeBoardId, clearViewportRequest, setViewport, fitView]);

  useEffect(() => {
    if (!activeBoardId) return;
    // Capture the camera a board opens with (the first visit's fit-view), so a
    // return is exact even if the reader never panned on it.
    const frame = requestAnimationFrame(() => {
      recordBoardViewport(activeBoardId, getViewport());
    });
    return () => cancelAnimationFrame(frame);
  }, [activeBoardId, recordBoardViewport, getViewport]);

  const lastMoveZoom = useRef<number | null>(null);
  /** Zoom a pan/zoom gesture started at; reverse zoom compares against it. */
  const gestureStartZoom = useRef<number | null>(null);
  /** Portals already entered by zooming, so a lingering overview does not re-enter. */
  const autoEntered = useRef(new Set<string>());
  /** The board the zoom-entry guards belong to. */
  const autoEnteredBoard = useRef<string | null>(null);
  // The drawer describes something on the board you were looking at, so a board
  // change — a portal doorway, a tab, a step back — leaves it behind.
  const seenBoardId = useRef(activeBoardId);
  useEffect(() => {
    if (seenBoardId.current === activeBoardId) return;
    seenBoardId.current = activeBoardId;
    useUiStore.getState().closeContainerInspector();
  }, [activeBoardId]);

  useEffect(() => {
    if (autoEnteredBoard.current === activeBoardId) return;
    autoEnteredBoard.current = activeBoardId;
    autoEntered.current.clear();
    lastMoveZoom.current = null;
  }, [activeBoardId]);

  /**
   * Two camera gestures end a board visit: zooming until a portal fills most of
   * the canvas enters it, and zooming far back out of a board entered through a
   * portal returns to the one before it. Both are read at the end of the
   * gesture, so neither reacts per frame.
   */
  const readCameraGesture = useCallback(
    (startZoom: number, zoom: number) => {
      const history = useUiStore.getState().boardHistory;
      const previousMove = lastMoveZoom.current;
      lastMoveZoom.current = zoom;

      // Reverse zoom: only a portal visit advertised itself as a doorway, and
      // only a deliberate pull-back (half the gesture's starting scale) counts.
      if (
        startZoom > 0 &&
        zoom <= startZoom * PORTAL_ZOOM_BACK_RATIO &&
        zoom < 0.6 &&
        history.at(-1)?.via === "portal"
      ) {
        goBackBoard();
        return;
      }

      // Entering needs an inward gesture; a fit-view or a tab switch must not
      // drop the reader into whichever portal happens to be on screen.
      if (previousMove === null || zoom <= previousMove * 1.02) return;
      const pane = document.querySelector<HTMLElement>('[data-testid="canvas-board"]');
      if (!pane) return;
      const paneRect = pane.getBoundingClientRect();
      if (paneRect.width === 0 || paneRect.height === 0) return;
      const paneArea = paneRect.width * paneRect.height;

      for (const [id, node] of store.getState().nodeLookup) {
        if (autoEntered.current.has(id)) continue;
        const targetBoardId = portalTargetId(cardsById.get(id));
        if (!targetBoardId) continue;
        const position = node.internals.positionAbsolute;
        const rect = nodeScreenRect(id);
        if (!rect) continue;
        const overlapWidth =
          Math.min(rect.left + rect.width, paneRect.right) - Math.max(rect.left, paneRect.left);
        const overlapHeight =
          Math.min(rect.top + rect.height, paneRect.bottom) - Math.max(rect.top, paneRect.top);
        if (overlapWidth <= 0 || overlapHeight <= 0) continue;
        if ((overlapWidth * overlapHeight) / paneArea < PORTAL_ZOOM_COVERAGE) continue;
        // `position` is read so a node without geometry is skipped rather than
        // measured at the origin, which would read as a full-canvas portal.
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
        autoEntered.current.add(id);
        enterPortal(id, targetBoardId);
        return;
      }
    },
    [store, cardsById, nodeScreenRect, enterPortal, goBackBoard],
  );

  return { enterPortal, nodeScreenRect, readCameraGesture, gestureStartZoom };
}
