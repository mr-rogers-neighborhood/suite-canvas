import { useStoreApi, useViewport, ViewportPortal } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type PeerPresence, peerIsInteracting } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { PeerNameTag } from "../components/PeerNameTag";
import { PresenceCursor } from "../components/PresenceCursor";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { type GroupRect, peerDragGroup } from "./presenceGroups";

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
 * The marquee a peer is drawing right now, in flow space and in their colour.
 * The name chip is counter-scaled so it stays readable at any zoom.
 */
function PeerSelectionBox({ peer, scale }: { peer: PeerPresence; scale: number }) {
  const box = peer.selectionBox;
  if (!box) return null;

  return (
    <div
      data-testid="peer-selection-box"
      data-peer-name={peer.user.name}
      className="peer-selection-box"
      style={{
        transform: `translate(${box.x}px, ${box.y}px)`,
        width: box.width,
        height: box.height,
        borderColor: peer.user.color,
        backgroundColor: `color-mix(in srgb, ${peer.user.color} 12%, transparent)`,
      }}
    >
      <span className="peer-selection-box__tag" style={{ transform: `scale(${scale})` }}>
        <PeerNameTag user={peer.user} />
      </span>
    </div>
  );
}

/**
 * The outline of a peer's multi-card drag, with their name chip attached to it
 * rather than to whichever card happens to be the anchor. It carries the
 * marquee's meaning forward: "these cards are moving together".
 */
function PeerDragGroup({
  peer,
  rect,
  scale,
}: {
  peer: PeerPresence;
  rect: GroupRect;
  scale: number;
}) {
  return (
    <div
      data-testid="peer-drag-group"
      data-peer-name={peer.user.name}
      className="peer-drag-group"
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.width,
        height: rect.height,
        borderColor: peer.user.color,
        backgroundColor: `color-mix(in srgb, ${peer.user.color} 8%, transparent)`,
      }}
    >
      <span className="peer-selection-box__tag" style={{ transform: `scale(${scale})` }}>
        <PeerNameTag user={peer.user} detail={`${rect.count} cards`} />
      </span>
    </div>
  );
}

/**
 * Renders peer cursors, marquees and group outlines in flow space, so they stay
 * aligned to the canvas while panning and zooming. Labels are counter-scaled to
 * keep a constant size.
 */
export function PresenceLayer() {
  const peers = usePresenceStore((state) => state.peers);
  const snapshot = useWorkspaceSnapshot();
  const store = useStoreApi();
  const { zoom } = useViewport();
  const inverseZoom = 1 / (zoom || 1);

  // Placements and measured sizes are read at paint time: a drag only moves the
  // cards, so nothing here has to subscribe to React Flow's node updates.
  const groups = useMemo(() => {
    const lookup = store.getState().nodeLookup;
    const placementsByBoard = new Map<string, Map<string, { x: number; y: number }>>();
    const placementsFor = (board: string | null) => {
      const key = board ?? "";
      const cached = placementsByBoard.get(key);
      if (cached) return cached;
      const placements = new Map<string, { x: number; y: number }>();
      for (const placement of snapshot.placements) {
        if (placement.boardId !== board) continue;
        placements.set(placement.cardId, { x: placement.x, y: placement.y });
      }
      placementsByBoard.set(key, placements);
      return placements;
    };

    const result = new Map<string, GroupRect>();
    for (const peer of Object.values(peers)) {
      if (!peer.dragging) continue;
      const sizes = new Map<string, { width: number; height: number }>();
      for (const id of peer.dragging.nodeIds ?? []) {
        const measured = lookup.get(id)?.measured;
        if (measured?.width && measured.height) {
          sizes.set(id, { width: measured.width, height: measured.height });
        }
      }
      const rect = peerDragGroup(peer.dragging, placementsFor(peer.board), sizes);
      if (rect) result.set(peer.clientId, rect);
    }
    return result;
  }, [peers, snapshot.placements, store]);

  return (
    <ViewportPortal>
      {Object.values(peers).map((peer) => {
        const rect = groups.get(peer.clientId);
        return rect ? (
          <PeerDragGroup
            key={`group-${peer.clientId}`}
            peer={peer}
            rect={rect}
            scale={inverseZoom}
          />
        ) : null;
      })}
      {Object.values(peers).map((peer) => (
        <PeerSelectionBox key={`box-${peer.clientId}`} peer={peer} scale={inverseZoom} />
      ))}
      {Object.values(peers).map((peer) => (
        <PeerPointer key={peer.clientId} peer={peer} scale={inverseZoom} />
      ))}
    </ViewportPortal>
  );
}
