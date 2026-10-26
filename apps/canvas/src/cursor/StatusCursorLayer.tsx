import { useReactFlow, useStoreApi, useViewport } from "@xyflow/react";
import type { CanvasMode } from "../canvas/linkGesture";
import type { CanvasPurpose } from "../canvas/purpose";
import type { PeerPresence } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { presenceChipInk } from "../components/PeerNameTag";
import { useUiStore } from "../store/useUiStore";
import { StatusCursor } from "./StatusCursor";

/**
 * The status cursor ([ADR-0064](../../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)):
 * the bubble with a corner pointer that carries the purpose, the gesture, the run and the
 * people — **for peers only**.
 *
 * It used to be drawn for the reader's own pointer as well, which is what the author
 * objected to: the pill already states both axes, in the same colours, permanently on
 * screen a few centimetres away. A ring that repeats it under the pointer is the same
 * sentence twice. Removing it costs the reader nothing they cannot get from the pill —
 * whose label and title still name the mode in words — and costs peers nothing at all,
 * because what we publish is unchanged.
 *
 * Drawn in screen space rather than in React Flow's `ViewportPortal`, because a cursor is
 * not part of the scene: it points at a place on the glass. Peers' flow-space pointers are
 * converted here, and their bubbles are counter-scaled so they keep one size at any zoom.
 *
 * A peer whose pointer is off this board has no bubble to draw — there is nowhere on the
 * glass to draw it — so they get an edge tick instead. That is the job the local bubble
 * used to do with its people stack, moved to where it belongs: the edge of the glass,
 * pointing the way they went.
 */

/** How far inside the canvas a tick sits, so it never half-hangs off the edge. */
const TICK_INSET = 18;

/** A cursor earns its bubble only once it says something a plain arrow cannot. */
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

/** Clamp an off-screen point onto the canvas edge, so the tick points the way they went. */
function edgePoint(point: { x: number; y: number }, bounds: DOMRect): { x: number; y: number } {
  return {
    x: Math.min(Math.max(point.x, bounds.left + TICK_INSET), bounds.right - TICK_INSET),
    y: Math.min(Math.max(point.y, bounds.top + TICK_INSET), bounds.bottom - TICK_INSET),
  };
}

export function StatusCursorLayer() {
  const readOnly = useUiStore((state) => state.readOnly);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const peers = usePresenceStore((state) => state.peers);
  const { zoom } = useViewport();
  const { flowToScreenPosition, setCenter } = useReactFlow();
  const store = useStoreApi();

  // A status cursor is a place on a board, so only peers looking at this board have one
  // to draw; a peer on another board would otherwise point at nothing here.
  const live = Object.values(peers).filter((peer) => {
    if (activeBoardId === null || peer.board !== activeBoardId || !peer.pointer) return false;
    const state = peerState(peer);
    return announcesState(state.purpose, state.gesture);
  });

  const onScreen: { peer: PeerPresence; point: { x: number; y: number } }[] = [];
  const outside: { peer: PeerPresence; point: { x: number; y: number } }[] = [];
  const bounds = store.getState().domNode?.getBoundingClientRect() ?? null;
  for (const peer of live) {
    if (!peer.pointer) continue;
    const point = flowToScreenPosition(peer.pointer);
    if (outsideOf(point, bounds)) outside.push({ peer, point });
    else onScreen.push({ peer, point });
  }

  if (readOnly) return null;

  const inverseZoom = 1 / (zoom || 1);
  const focusPeer = (point: { x: number; y: number }) => {
    // Zoom in only as far as it takes to see one: yanking a zoomed-out reader to 100%
    // makes the move a jump instead of a nudge.
    void setCenter(point.x, point.y, { zoom: Math.max(zoom, 0.6), duration: 260 });
  };

  return (
    <>
      {onScreen.map(({ peer, point }) => (
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
            purpose={peerState(peer).purpose}
            gesture={peerState(peer).gesture}
            isSelf={false}
          />
        </div>
      ))}
      {bounds
        ? outside.map(({ peer, point }) => {
            const at = edgePoint(point, bounds);
            return (
              <button
                key={`edge-${peer.clientId}`}
                type="button"
                className="peer-edge-tick"
                data-testid="peer-edge-tick"
                data-peer-name={peer.user.name}
                title={`${peer.user.name} is off this view — bring them into view`}
                aria-label={`Bring ${peer.user.name} into view`}
                style={{
                  left: `${at.x}px`,
                  top: `${at.y}px`,
                  borderColor: peer.user.color,
                }}
                onClick={() => focusPeer(point)}
              >
                <span
                  aria-hidden="true"
                  className="peer-edge-tick__initial"
                  style={{
                    backgroundColor: peer.user.color,
                    color: presenceChipInk(peer.user.color),
                  }}
                >
                  {peer.user.name.charAt(0).toUpperCase()}
                </span>
              </button>
            );
          })
        : null}
    </>
  );
}
