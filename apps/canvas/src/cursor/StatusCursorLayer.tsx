import { useReactFlow, useStoreApi, useViewport } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import type { CanvasMode } from "../canvas/linkGesture";
import { usePlacementRunStore } from "../canvas/placementRun";
import type { CanvasPurpose } from "../canvas/purpose";
import type { PeerPresence, PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useUiStore } from "../store/useUiStore";
import { StatusCursor } from "./StatusCursor";

/**
 * The status cursor ([ADR-0064](../../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)):
 * the bubble with a corner pointer that carries the purpose, the gesture, the run
 * and the people, for the local pointer and for peers.
 *
 * Drawn in screen space rather than in React Flow's `ViewportPortal`, because a
 * cursor is not part of the scene: it points at a place on the glass. Peers'
 * flow-space pointers are converted here, and their bubbles are counter-scaled so
 * they keep one size at any zoom.
 */

export interface StatusCursorLayerProps {
  /**
   * Unread chat count for the reader's own cursor. The chat lane feeds this;
   * nothing here builds chat (ADR-0064 §4).
   */
  unread?: number;
}

/**
 * A cursor earns its bubble only once it says something a plain arrow cannot.
 * `explore` + `place` is the resting state — the ordinary pointer a reader already
 * understands — so both the local cursor and a peer's stay out of the way until a
 * purpose or a gesture is on. That also keeps a peer from being drawn twice: the
 * arrow and name chip in `PresenceLayer` already answer "where are they".
 */
function announcesState(purpose: CanvasPurpose, gesture: CanvasMode): boolean {
  return purpose !== "explore" || gesture !== "place";
}

function peerState(peer: PeerPresence): { purpose: CanvasPurpose; gesture: CanvasMode } {
  // An older client publishes neither field; it can only be in the resting state.
  return { purpose: peer.purpose ?? "explore", gesture: peer.gesture ?? "place" };
}

function outsideOf(point: { x: number; y: number }, bounds: DOMRect | null): boolean {
  if (!bounds) return false;
  return (
    point.x < bounds.left ||
    point.x > bounds.right ||
    point.y < bounds.top ||
    point.y > bounds.bottom
  );
}

export function StatusCursorLayer({ unread = 0 }: StatusCursorLayerProps) {
  const readOnly = useUiStore((state) => state.readOnly);
  const purpose = useUiStore((state) => state.purpose);
  const gesture = useUiStore((state) => state.mode);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const run = usePlacementRunStore((state) => state.run);
  const localUser = usePresenceStore((state) => state.localUser);
  const peers = usePresenceStore((state) => state.peers);
  const { zoom } = useViewport();
  const { flowToScreenPosition, setCenter } = useReactFlow();
  const store = useStoreApi();

  const showsLocal = !readOnly && announcesState(purpose, gesture);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const showsRef = useRef(showsLocal);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    showsRef.current = showsLocal;
  }, [showsLocal]);

  // Window, not the board: the pointer leaves the canvas the moment the reader
  // reaches for the mode control and comes back, and a cursor that blanks on every
  // pill is a cursor that flickers. The position is kept in a ref while nothing is
  // showing, so entering a mode paints at the point the reader is already at
  // instead of waiting for the next pixel of movement.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (showsRef.current) setPointer(pointerRef.current);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useEffect(() => {
    setPointer(showsLocal ? pointerRef.current : null);
  }, [showsLocal]);

  // A status cursor is a place on a board, so only peers looking at this board have
  // one to draw; a peer on another board would otherwise point at nothing here.
  const live = Object.values(peers).filter((peer) => {
    if (activeBoardId === null || peer.board !== activeBoardId || !peer.pointer) return false;
    const state = peerState(peer);
    return announcesState(state.purpose, state.gesture);
  });

  const onScreen: { peer: PeerPresence; point: { x: number; y: number } }[] = [];
  const outside: PeerPresence[] = [];
  if (live.length > 0) {
    const bounds = store.getState().domNode?.getBoundingClientRect() ?? null;
    for (const peer of live) {
      if (!peer.pointer) continue;
      const point = flowToScreenPosition(peer.pointer);
      if (outsideOf(point, bounds)) outside.push(peer);
      else onScreen.push({ peer, point });
    }
  }

  const outsideUsers: PresenceUser[] = outside.map((peer) => peer.user);
  const placed = run?.placed.length ?? 0;
  const total = placed + (run?.queue.length ?? 0);
  const runProgress = run && total > 0 ? { placed, total } : null;

  const focusOutside = () => {
    const first = outside.find((peer) => peer.pointer !== null);
    if (!first?.pointer) return;
    // Zoom in only as far as it takes to see one: yanking a zoomed-out reader to
    // 100% makes the stack a jump instead of a nudge.
    void setCenter(first.pointer.x, first.pointer.y, {
      zoom: Math.max(zoom, 0.6),
      duration: 260,
    });
  };

  if (readOnly) return null;

  const inverseZoom = 1 / (zoom || 1);

  return (
    <>
      {onScreen.map(({ peer, point }) => {
        const state = peerState(peer);
        return (
          <div
            key={`peer-${peer.clientId}`}
            className="status-cursor-anchor"
            style={{
              left: `${point.x}px`,
              top: `${point.y}px`,
              transform: `scale(${inverseZoom})`,
            }}
          >
            <StatusCursor
              user={peer.user}
              purpose={state.purpose}
              gesture={state.gesture}
              isSelf={false}
            />
          </div>
        );
      })}
      {showsLocal && pointer ? (
        <div
          className="status-cursor-anchor"
          style={{ left: `${pointer.x}px`, top: `${pointer.y}px` }}
        >
          <StatusCursor
            user={localUser}
            purpose={purpose}
            gesture={gesture}
            runProgress={runProgress}
            unread={unread}
            peers={outsideUsers}
            isSelf
            onPeersClick={focusOutside}
          />
        </div>
      ) : null}
    </>
  );
}
