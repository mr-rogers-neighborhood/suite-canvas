import { useStore, ViewportPortal } from "@xyflow/react";
import { useEffect } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * Library drags, for peers.
 *
 * The drawer owns the gesture and the canvas owns the camera, so the drawer
 * publishes a *screen* point on `useUiStore` and this module — which lives inside
 * the flow — converts it to a flow point before handing it to presence. Peers draw
 * a ghost where the card would land, in board space; a screen point would only
 * mean anything on the sender's own window.
 */
export function usePublishLibraryDrag(): void {
  const drag = useUiStore((state) => state.libraryDrag);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const setLibraryDrag = usePresenceStore((state) => state.setLibraryDrag);
  const transform = useStore((state) => state.transform);

  useEffect(() => {
    if (!drag) {
      setLibraryDrag(null);
      return;
    }
    const [tx, ty, zoom] = transform;
    const scale = zoom || 1;
    setLibraryDrag({
      cardId: drag.cardId,
      position: { x: (drag.screen.x - tx) / scale, y: (drag.screen.y - ty) / scale },
      board: activeBoardId,
    });
  }, [drag, transform, activeBoardId, setLibraryDrag]);
}

/**
 * The reader's own held library card, drawn where it would land.
 *
 * The drawer shows the card at the pointer in screen space; this is the other half
 * of the same gesture — the *board* space outline that says where it will land and
 * how big it will be. Without it a drag is a title following the cursor and a drop
 * that lands where nobody expected.
 */
export function LibraryDropPreview() {
  const drag = useUiStore((state) => state.libraryDrag);
  const canPlace = useUiStore((state) => state.canEditLayout);
  const workspace = useCanvasStore((state) => state.workspace);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const transform = useStore((state) => state.transform);
  const inverseZoom = 1 / (transform[2] || 1);
  if (!drag || !canPlace || activeBoardId === null) return null;

  const [tx, ty, zoom] = transform;
  const scale = zoom || 1;
  const position = {
    x: (drag.screen.x - tx) / scale,
    y: (drag.screen.y - ty) / scale,
  };

  return (
    <ViewportPortal>
      <div
        data-testid="library-drop-preview"
        className="library-drop-preview"
        style={{
          // Centred on the pointer in screen units, then inverted so the frame is a
          // constant band on screen at any zoom — a frame, not a card.
          transform: `translate(${position.x}px, ${position.y}px) scale(${inverseZoom})`,
        }}
      >
        <span className="library-drop-preview__title">
          {workspace.displayTitle(drag.cardId) || "Card"}
        </span>
      </div>
    </ViewportPortal>
  );
}

/** A collaborator's held library card, drawn where it would land. */
export function PeerLibraryDragLayer() {
  const peers = usePresenceStore((state) => state.peers);
  const selfId = usePresenceStore((state) => state.peerId);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const workspace = useCanvasStore((state) => state.workspace);
  const transform = useStore((state) => state.transform);
  const inverseZoom = 1 / (transform[2] || 1);

  const drags = Object.values(peers).filter(
    (peer) =>
      peer.libraryDrag &&
      peer.clientId !== selfId &&
      (peer.libraryDrag.board === null || peer.libraryDrag.board === activeBoardId),
  );
  if (drags.length === 0) return null;

  return (
    <ViewportPortal>
      {drags.map((peer) => {
        const drag = peer.libraryDrag;
        if (!drag) return null;
        // A ghost is a hint at arm's length: the same size on screen at any zoom.
        return (
          <div
            key={peer.clientId}
            data-testid="peer-library-ghost"
            className="peer-library-ghost"
            style={{
              transform: `translate(${drag.position.x}px, ${drag.position.y}px) scale(${inverseZoom})`,
              borderColor: peer.user.color,
            }}
          >
            <span className="peer-library-ghost__name" style={{ background: peer.user.color }}>
              {peer.user.name}
            </span>
            <span className="peer-library-ghost__title">
              {/* A peer may not have the title yet; the position and the name are
                  the information, the title is a bonus. */}
              {workspace.displayTitle(drag.cardId) || "Card"}
            </span>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
