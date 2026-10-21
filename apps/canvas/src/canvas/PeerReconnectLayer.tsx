import type { Card, GraphEdge } from "@suite/graph";
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
import { useWorkspaceSnapshot } from "../hooks/useWorkspaceSnapshot";

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
  card,
  connectorId,
  movingEnd,
  target,
  pointer,
  color,
}: {
  edge: GraphEdge;
  card: Card;
  connectorId: string | undefined;
  /** The end following the pointer; the anchored end is the other one. */
  movingEnd: "source" | "target";
  /** Connector the mover has snapped to, if any. */
  target: { card: Card; connectorId: string } | null;
  pointer: Point;
  color: string;
}) {
  const anchorNode = useInternalNode(card.id);
  const targetNode = useInternalNode(target?.card.id ?? "");
  const anchorMeasured = anchorNode?.measured;
  const connector = card.connectors.find((candidate) => candidate.id === connectorId);
  const targetConnector = target?.card.connectors.find(
    (candidate) => candidate.id === target.connectorId,
  );

  if (!anchorNode || !anchorMeasured?.width || !anchorMeasured?.height || !connector) return null;

  const anchor = {
    x: anchorNode.internals.positionAbsolute.x + connector.x * anchorMeasured.width,
    y: anchorNode.internals.positionAbsolute.y + connector.y * anchorMeasured.height,
  };
  const anchorSide = sideOf(connector);

  const targetSize = targetNode?.measured;
  const snappedTarget =
    targetNode && targetSize?.width && targetSize.height && targetConnector
      ? {
          point: {
            x: targetNode.internals.positionAbsolute.x + targetConnector.x * targetSize.width,
            y: targetNode.internals.positionAbsolute.y + targetConnector.y * targetSize.height,
          },
          side: sideOf(targetConnector),
        }
      : null;

  // Snapped ends meet the connector perpendicularly, exactly like the real edge.
  const end = snappedTarget ?? { point: pointer, side: OPPOSITE[anchorSide] };

  const d = pathFor(edge.path, anchor, anchorSide, end.point, end.side);
  const markerId = `peer-reconnect-arrow-${edge.id}-${color.replace(/\W/g, "")}`;

  // Arrows belong where the finished link will have them: at its target, and at
  // both ends when bidirectional — never at the end the pointer is holding.
  const anchoredEnd = movingEnd === "target" ? "source" : "target";
  const arrowAtStart = edge.bidirectional || anchoredEnd === "target";
  const arrowAtEnd = edge.bidirectional || movingEnd === "target";
  const arrows =
    arrowAtStart && arrowAtEnd ? "both" : arrowAtStart ? "start" : arrowAtEnd ? "end" : "none";

  return (
    <svg className="peer-reconnect-preview" aria-hidden="true">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="10"
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
        data-snapped={snappedTarget ? "true" : undefined}
        data-arrows={arrows}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="6 4"
        strokeLinecap="round"
        {...(arrowAtStart ? { markerStart: `url(#${markerId})` } : {})}
        {...(arrowAtEnd ? { markerEnd: `url(#${markerId})` } : {})}
      />
    </svg>
  );
}

/** Renders peers' in-flight link drags in flow space, next to their cursors. */
export function PeerReconnectLayer() {
  const peers = usePresenceStore((state) => state.peers);
  const { cards, edges } = useWorkspaceSnapshot();
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);

  const resolveTarget = (target: { nodeId: string; connectorId: string } | undefined) => {
    if (!target) return null;
    const card = cardsById.get(target.nodeId);
    return card ? { card, connectorId: target.connectorId } : null;
  };

  return (
    <ViewportPortal>
      {Object.values(peers).map((peer) => {
        const state = peer.reconnect;
        if (!state) return null;

        const edge = edges.find((candidate) => candidate.id === state.edgeId);
        if (!edge) return null;

        const draggingSource = state.end === "source";
        const anchorCard = cardsById.get(draggingSource ? edge.target : edge.source);
        if (!anchorCard) return null;

        return (
          <ReconnectPreview
            key={peer.clientId}
            edge={edge}
            card={anchorCard}
            connectorId={draggingSource ? edge.targetConnector : edge.sourceConnector}
            movingEnd={state.end}
            target={resolveTarget(state.target)}
            pointer={state.position}
            color={peer.user.color}
          />
        );
      })}
    </ViewportPortal>
  );
}
