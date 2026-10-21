import { useViewport, ViewportPortal } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { type PeerPresence, peerIsInteracting } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { PresenceCursor } from "../components/PresenceCursor";

const POINTER_EXIT_MS = 180;

function PeerPointer({ peer, scale }: { peer: PeerPresence; scale: number }) {
  const interacting = peerIsInteracting(peer);
  const lastPointer = useRef(peer.pointer);
  const [pointer, setPointer] = useState(peer.pointer);
  const [phase, setPhase] = useState<"visible" | "leaving" | "hidden">(
    peer.pointer ? "visible" : "hidden",
  );

  useEffect(() => {
    if (interacting) {
      if (!lastPointer.current) {
        setPhase("hidden");
        return;
      }
      setPointer(lastPointer.current);
      setPhase("leaving");
      const timer = window.setTimeout(() => {
        setPointer(null);
        setPhase("hidden");
      }, POINTER_EXIT_MS);
      return () => window.clearTimeout(timer);
    }

    if (!peer.pointer) return;
    lastPointer.current = peer.pointer;
    setPointer(peer.pointer);
    setPhase("visible");
  }, [interacting, peer.pointer]);

  if (!pointer || phase === "hidden") return null;

  return (
    <PresenceCursor
      user={peer.user}
      x={pointer.x}
      y={pointer.y}
      scale={scale}
      leaving={phase === "leaving"}
    />
  );
}

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
      {Object.values(peers).map((peer) => (
        <PeerPointer key={peer.clientId} peer={peer} scale={inverseZoom} />
      ))}
    </ViewportPortal>
  );
}
