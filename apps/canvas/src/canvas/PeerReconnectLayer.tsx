import type { Card, GraphEdge } from "@suite/graph";
import {
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Position,
  useInternalNode,
  useViewport,
  ViewportPortal,
} from "@xyflow/react";
import { Fragment, type ReactNode, useMemo } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { type Point, sideOf } from "../components/Connector";
import { PeerNameTag } from "../components/PeerNameTag";
import { useCards, useEdges } from "../store/workspaceStore";

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
function LinkPreview({
  card,
  connectorId,
  movingEnd,
  target,
  pointer,
  path,
  bidirectional,
  color,
  user,
  scale,
  className,
  testId,
  markerId,
}: {
  /** Card the preview stays anchored to. */
  card: Card;
  connectorId: string | undefined;
  /** The end following the pointer; the anchored end is the other one. */
  movingEnd: "source" | "target";
  /** Connector the mover has snapped to, if any. */
  target: { card: Card; connectorId: string } | null;
  pointer: Point;
  path: GraphEdge["path"];
  bidirectional: boolean;
  color: string;
  user: { name: string; color: string };
  scale: number;
  className: string;
  testId: string;
  markerId: string;
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

  const d = pathFor(path, anchor, anchorSide, end.point, end.side);

  // Arrows belong where the finished link will have them: at its target, and at
  // both ends when bidirectional — never at the end the pointer is holding.
  const anchoredEnd = movingEnd === "target" ? "source" : "target";
  const arrowAtStart = bidirectional || anchoredEnd === "target";
  const arrowAtEnd = bidirectional || movingEnd === "target";
  const arrows =
    arrowAtStart && arrowAtEnd ? "both" : arrowAtStart ? "start" : arrowAtEnd ? "end" : "none";

  return (
    <>
      <svg className={className} aria-hidden="true">
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
          data-testid={testId}
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
      <div
        className="peer-link-name"
        style={{
          transform: `translate(${end.point.x}px, ${end.point.y + 10}px) scale(${scale})`,
        }}
      >
        <PeerNameTag user={user} />
      </div>
    </>
  );
}

/** Renders peers' in-flight link drags in flow space, next to their cursors. */
export function PeerReconnectLayer() {
  const peers = usePresenceStore((state) => state.peers);
  const cards = useCards();
  const edges = useEdges();
  const { zoom } = useViewport();
  const inverseZoom = 1 / (zoom || 1);
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);

  const resolveTarget = (target: { nodeId: string; connectorId: string } | undefined) => {
    if (!target) return null;
    const card = cardsById.get(target.nodeId);
    return card ? { card, connectorId: target.connectorId } : null;
  };

  return (
    <ViewportPortal>
      {Object.values(peers).map((peer) => {
        const previews: ReactNode[] = [];

        const reconnect = peer.reconnect;
        if (reconnect) {
          const edge = edges.find((candidate) => candidate.id === reconnect.edgeId);
          const draggingSource = reconnect.end === "source";
          const anchorCard = edge
            ? cardsById.get(draggingSource ? edge.target : edge.source)
            : undefined;

          if (edge && anchorCard) {
            previews.push(
              <LinkPreview
                key="reconnect"
                card={anchorCard}
                connectorId={draggingSource ? edge.targetConnector : edge.sourceConnector}
                movingEnd={reconnect.end}
                target={resolveTarget(reconnect.target)}
                pointer={reconnect.position}
                path={edge.path}
                bidirectional={edge.bidirectional}
                color={peer.user.color}
                user={peer.user}
                scale={inverseZoom}
                className="peer-reconnect-preview"
                testId="peer-reconnect-preview"
                markerId={`peer-reconnect-arrow-${edge.id}-${peer.user.color.replace(/\W/g, "")}`}
              />,
            );
          }
        }

        // New links have no edge yet: the preview runs from the anchored
        // connector to the pointer, or to the connector React Flow snapped to.
        const connect = peer.connect;
        if (connect) {
          const anchorCard = cardsById.get(connect.nodeId);
          if (anchorCard) {
            previews.push(
              <LinkPreview
                key="connect"
                card={anchorCard}
                connectorId={connect.connectorId}
                movingEnd={connect.anchorEnd === "source" ? "target" : "source"}
                target={resolveTarget(connect.target)}
                pointer={connect.position}
                path="bezier"
                bidirectional={false}
                color={peer.user.color}
                user={peer.user}
                scale={inverseZoom}
                className="peer-connect-preview"
                testId="peer-connect-preview"
                markerId={`peer-connect-arrow-${peer.clientId}-${connect.nodeId}-${connect.connectorId}-${peer.user.color.replace(/\W/g, "")}`}
              />,
            );
          }
        }

        return previews.length > 0 ? <Fragment key={peer.clientId}>{previews}</Fragment> : null;
      })}
    </ViewportPortal>
  );
}
