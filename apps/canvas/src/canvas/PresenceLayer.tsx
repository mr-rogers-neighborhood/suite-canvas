import { useViewport, ViewportPortal } from "@xyflow/react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { PresenceCursor } from "../components/PresenceCursor";

/**
 * Renders peer cursors in flow space, so they stay aligned to the canvas while
 * panning and zooming. Labels are counter-scaled to keep a constant size.
 */
export function PresenceLayer() {
  const peers = usePresenceStore((state) => state.peers);
  const { zoom } = useViewport();
  const inverseZoom = 1 / (zoom || 1);

  return (
    <ViewportPortal>
      {Object.values(peers).map((peer) =>
        peer.pointer ? (
          <PresenceCursor
            key={peer.clientId}
            user={peer.user}
            x={peer.pointer.x}
            y={peer.pointer.y}
            scale={inverseZoom}
          />
        ) : null,
      )}
    </ViewportPortal>
  );
}
