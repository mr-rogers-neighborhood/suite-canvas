import { usePresenceStore } from "../collab/usePresenceStore";
import { PresenceCursor } from "../components/PresenceCursor";

export function PresenceLayer() {
  const peers = usePresenceStore((state) => state.peers);

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      {Object.values(peers).map((peer) =>
        peer.pointer ? (
          <PresenceCursor
            key={peer.clientId}
            user={peer.user}
            x={peer.pointer.x}
            y={peer.pointer.y}
          />
        ) : null,
      )}
    </div>
  );
}
