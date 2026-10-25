import type { Connector as ConnectorModel } from "@suite/graph";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import type { PresenceUser } from "../collab/presence";
import { Connector, type Point } from "../components/Connector";

/** Everyone dragging one connector, plus where the first of them is holding it. */
export interface ConnectorPeerState {
  users: PresenceUser[];
  position: Point | null;
}

/** Why a dot is on screen: the entity is selected, a link mode is on, or a
 * link is being dragged out. One predicate, so the node kinds cannot drift. */
export interface ConnectorRevealInput {
  selected?: boolean | undefined;
  chaining?: boolean | undefined;
  draftActive?: boolean | undefined;
  /** The pointer is over the entity, so its dots come to hand without a click. */
  hovered?: boolean | undefined;
  /**
   * A thread is armed: one connector has been clicked and the next click picks
   * its target, so every candidate must be visible even in connect mode.
   */
  armed?: boolean | undefined;
  /**
   * A collaborator is manipulating one of this node's connectors. Presence is
   * painted *inside* this layer, so a peer holding a dot would otherwise be
   * invisible to anyone who is not hovering the card.
   */
  peerActive?: boolean | undefined;
}

/** The single reveal rule for every connector layer, cards and sections alike. */
export function revealConnectors({
  selected = false,
  chaining = false,
  draftActive = false,
  hovered = false,
  armed = false,
  peerActive = false,
}: ConnectorRevealInput): boolean {
  return selected || chaining || draftActive || hovered || armed || peerActive;
}

export interface NodeConnectorsProps {
  /** Card (or node) the dots belong to; also the React Flow node id. */
  nodeId: string;
  connectors: readonly ConnectorModel[];
  color?: string | undefined;
  /**
   * The node itself is selected. Connectors are a wiring aid, not a permanent
   * decoration, so an unselected node paints none of them.
   */
  selected?: boolean | undefined;
  /**
   * Thread mode: the user is picking link targets, so every node shows its dots.
   * W2 owns the toggle; the layer only reads it.
   */
  chaining?: boolean | undefined;
  /** A link is being dragged right now, so every reachable target must show. */
  draftActive?: boolean | undefined;
  /** A thread is armed: the next click picks a target, so show every candidate. */
  armed?: boolean | undefined;
  /** The armed end of the chain, when it is one of this node's dots. */
  armedConnectorId?: string | null | undefined;
  /** A peer is dragging or has selected a dot here, so the layer must be up. */
  peerActive?: boolean | undefined;
  /** Override the hover read from the surrounding node (sections have no node). */
  hovered?: boolean | undefined;
  selectedConnectorId?: string | null | undefined;
  /** Peers dragging a connector, keyed by connector id. */
  movingConnectorPeers?: Record<string, ConnectorPeerState> | undefined;
  /** Peers that selected a connector, keyed by connector id. */
  selectingConnectorPeers?: Record<string, PresenceUser[]> | undefined;
  onSelect?: ((connectorId: string, event?: React.MouseEvent) => void) | undefined;
  onMoveStart?: ((connectorId: string) => void) | undefined;
  onMove?: ((connectorId: string, position: Point) => void) | undefined;
  onMoveFinished?: (() => void) | undefined;
  onMoveEnd?: ((connectorId: string, position: Point) => void) | undefined;
  onContextMenu?: ((event: React.MouseEvent, connectorId: string) => void) | undefined;
}

/**
 * The connector dots for one node, whatever kind it is. Every node face mounts
 * this the same way, so a portal, a sketch and a note behave identically: the
 * same dots in the same place, the same select, move, link and menu gestures.
 *
 * The layer is positioned over the node box and lets pointer events through,
 * so dragging the node still works everywhere except on a dot or its grab ring.
 *
 * Dots are only *visible* while the node is selected, thread mode is on, or a
 * link is being dragged (the drop targets must be visible mid-gesture): an
 * always-on wiring diagram was visual noise. The handles stay mounted because
 * React Flow needs their measured bounds to start a connection; the reveal is a
 * CSS visibility rule, not a mount rule.
 */
export function NodeConnectors({
  nodeId,
  connectors,
  color,
  selected = false,
  chaining = false,
  draftActive = false,
  armed = false,
  armedConnectorId = null,
  peerActive = false,
  hovered: hoveredProp,
  selectedConnectorId = null,
  movingConnectorPeers = {},
  selectingConnectorPeers = {},
  onSelect,
  onMoveStart,
  onMove,
  onMoveFinished,
  onMoveEnd,
  onContextMenu,
}: NodeConnectorsProps) {
  const updateNodeInternals = useUpdateNodeInternals();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredSelf, setHoveredSelf] = useState(false);
  // The layer is pointer-transparent so the card keeps its own gestures, so the
  // hover is read from the node wrapper around it, not from the layer itself.
  useEffect(() => {
    const node = layerRef.current?.closest(".react-flow__node");
    if (!node) return;
    const enter = () => setHoveredSelf(true);
    const leave = () => setHoveredSelf(false);
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    return () => {
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
    };
  }, []);
  const hovered = hoveredProp ?? hoveredSelf;
  const revealed = revealConnectors({
    selected,
    chaining,
    draftActive,
    hovered,
    armed,
    peerActive,
  });
  const count = connectors.length;

  // Handles stay mounted whether or not they are visible: React Flow only starts
  // a connection from a handle it has measured, so unmounting the dots would
  // leave the node with stale handle bounds and no way to draw a link at all.
  // Revealing is therefore a visibility rule (`data-revealed`), never a mount rule.
  // Re-measure only when the set of dots changes: a connector added or removed
  // after mount moves a handle React Flow has already measured. Calling this on
  // mount instead re-measures mid-initial-fit and clamps the viewport to the
  // first node, which then hides every other node behind visibility culling.
  const previousCount = useRef(count);
  useEffect(() => {
    if (previousCount.current === count) return;
    previousCount.current = count;
    updateNodeInternals(nodeId);
  }, [updateNodeInternals, nodeId, count]);

  if (count === 0) return null;

  return (
    <div
      ref={layerRef}
      className="node-connectors"
      data-testid="node-connectors"
      data-node-id={nodeId}
      data-revealed={revealed ? "true" : "false"}
    >
      {connectors.map((connector) => (
        <Connector
          key={connector.id}
          connector={connector}
          nodeId={nodeId}
          color={color}
          selected={selectedConnectorId === connector.id}
          armed={armedConnectorId === connector.id}
          onSelect={(id, event) => onSelect?.(id, event)}
          onMoveEnd={(id, position) => onMoveEnd?.(id, position)}
          movingPeers={movingConnectorPeers[connector.id]?.users ?? []}
          selectingPeers={selectingConnectorPeers[connector.id] ?? []}
          peerPosition={movingConnectorPeers[connector.id]?.position ?? null}
          onMoveStart={() => onMoveStart?.(connector.id)}
          onMove={(position) => onMove?.(connector.id, position)}
          onMoveFinished={onMoveFinished}
          onContextMenu={(event, id) => onContextMenu?.(event, id)}
        />
      ))}
    </div>
  );
}
