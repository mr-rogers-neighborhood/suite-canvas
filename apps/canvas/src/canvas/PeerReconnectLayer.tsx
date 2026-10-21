import type { GraphEdge, GraphNode } from "@suite/graph";
import {
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Position,
  useInternalNode,
  ViewportPortal,
} from "@xyflow/react";
import { useMemo } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { type Point, sideOf } from "../components/Connector";
import { useGraphSnapshot } from "../hooks/useGraphSnapshot";

const OPPOSITE: Record<Position, Position> = {
  [Position.Top]: Position.Bottom,
  [Position.Right]: Position.Left,
  [Position.Bottom]: Position.Top,
  [Position.Left]: Position.Right,
};

function pathFor(
  kind: GraphEdge["path"],
  from: Point,
  fromSide: Position,
  to: Point,
  toSide: Position,
): string {
  const args = {
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: fromSide,
    targetX: to.x,
    targetY: to.y,
    targetPosition: toSide,
  };
  if (kind === "straight") return getStraightPath(args)[0];
  if (kind === "step") return getSmoothStepPath({ ...args, borderRadius: 0 })[0];
  if (kind === "smoothstep") return getSmoothStepPath(args)[0];
  return getBezierPath(args)[0];
}

/**
 * Draws the link a peer is currently dragging: a dashed path from its anchored
 * connector to their pointer, using the same path style as the real edge.
 */
function ReconnectPreview({
  edge,
  node,
  connectorId,
  pointer,
  color,
}: {
  edge: GraphEdge;
  node: GraphNode;
  connectorId: string | undefined;
  pointer: Point;
  color: string;
}) {
  const internal = useInternalNode(node.id);
  const measured = internal?.measured;
  const connector = node.connectors.find((candidate) => candidate.id === connectorId);

  if (!internal || !measured?.width || !measured?.height || !connector) return null;

  const anchor = {
    x: internal.internals.positionAbsolute.x + connector.x * measured.width,
    y: internal.internals.positionAbsolute.y + connector.y * measured.height,
  };
  const anchorSide = sideOf(connector);
  // The free end points back at the anchor, so the curve bows away from the card.
  const d = pathFor(edge.path, anchor, anchorSide, pointer, OPPOSITE[anchorSide]);
  const markerId = `peer-reconnect-arrow-${edge.id}-${color.replace(/\W/g, "")}`;

  return (
    <svg className="peer-reconnect-preview" aria-hidden="true">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      <path
        data-testid="peer-reconnect-preview"
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="6 4"
        strokeLinecap="round"
        markerEnd={`url(#${markerId})`}
      />
    </svg>
  );
}

/** Renders peers' in-flight link drags in flow space, next to their cursors. */
export function PeerReconnectLayer() {
  const peers = usePresenceStore((state) => state.peers);
  const { nodes, edges } = useGraphSnapshot();
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return (
    <ViewportPortal>
      {Object.values(peers).map((peer) => {
        const state = peer.reconnect;
        if (!state) return null;

        const edge = edges.find((candidate) => candidate.id === state.edgeId);
        if (!edge) return null;

        const draggingSource = state.end === "source";
        const anchorNode = nodesById.get(draggingSource ? edge.target : edge.source);
        if (!anchorNode) return null;

        return (
          <ReconnectPreview
            key={peer.clientId}
            edge={edge}
            node={anchorNode}
            connectorId={draggingSource ? edge.targetConnector : edge.sourceConnector}
            pointer={state.position}
            color={peer.user.color}
          />
        );
      })}
    </ViewportPortal>
  );
}
