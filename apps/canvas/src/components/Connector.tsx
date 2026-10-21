import { CONNECTOR_ANCHORS, type Connector as ConnectorModel } from "@suite/graph";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PresenceUser } from "../collab/presence";
import { PeerNameTag } from "./PeerNameTag";

export interface ConnectorProps {
  connector: ConnectorModel;
  nodeId: string;
  color?: string | undefined;
  selected?: boolean;
  onSelect: (connectorId: string) => void;
  /** Persisted once, on release, so dragging never writes to the CRDT per frame. */
  onMoveEnd: (connectorId: string, position: { x: number; y: number }) => void;
  onContextMenu: (event: React.MouseEvent, connectorId: string) => void;
  /** Peers currently dragging this connector, shown as a colored ring. */
  movingPeers?: PresenceUser[];
  /** Peers that have clicked this connector, shown as a dashed outline. */
  selectingPeers?: PresenceUser[];
  /** Where a peer is holding the connector right now, in perimeter fractions. */
  peerPosition?: Point | null;
  /** Broadcast (throttled) while this client drags, so peers see the move live. */
  onMove?: ((position: Point) => void) | undefined;
  /** Called when this client starts/stops dragging the connector. */
  onMoveStart?: (() => void) | undefined;
  onMoveFinished?: (() => void) | undefined;
}

/** Magnetic radius around a corner/side midpoint, in screen pixels. */
const MAGNET_RADIUS = 20;

/** Share of the remaining distance covered per frame when easing toward a peer. */
const PEER_SMOOTHING = 0.22;

/** Throttle for broadcasting a live connector position, in milliseconds. */
const MOVE_THROTTLE_MS = 40;

export interface Point {
  x: number;
  y: number;
}

/** Projects a pointer position onto the card perimeter, in 0..1 fractions. */
function projectToPerimeter(rect: DOMRect, clientX: number, clientY: number): Point {
  const px = Math.min(rect.width, Math.max(0, clientX - rect.left));
  const py = Math.min(rect.height, Math.max(0, clientY - rect.top));

  const edges = [
    { edge: "top" as const, distance: Math.abs(py) },
    { edge: "bottom" as const, distance: Math.abs(rect.height - py) },
    { edge: "left" as const, distance: Math.abs(px) },
    { edge: "right" as const, distance: Math.abs(rect.width - px) },
  ].sort((a, b) => a.distance - b.distance);

  const closest = edges[0]?.edge ?? "top";
  const x = rect.width === 0 ? 0.5 : px / rect.width;
  const y = rect.height === 0 ? 0.5 : py / rect.height;

  switch (closest) {
    case "top":
      return { x, y: 0 };
    case "bottom":
      return { x, y: 1 };
    case "left":
      return { x: 0, y };
    default:
      return { x: 1, y };
  }
}

/** Attracts a free perimeter position to a nearby anchor; otherwise leaves it alone. */
function magnetize(position: Point, rect: DOMRect): Point {
  let best: Point | null = null;
  let bestDistance = MAGNET_RADIUS;

  for (const anchor of CONNECTOR_ANCHORS) {
    const dx = (anchor.x - position.x) * rect.width;
    const dy = (anchor.y - position.y) * rect.height;
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }

  return best ? { ...best } : position;
}

function isAnchor(position: Point): boolean {
  return CONNECTOR_ANCHORS.some((anchor) => anchor.x === position.x && anchor.y === position.y);
}

/**
 * React Flow routes an edge according to the handle's declared side. Connectors
 * can sit anywhere on the perimeter, so the side is derived from the position —
 * otherwise every edge would enter vertically and hook into the dot.
 */
/** The card side a connector sits on, so links leave it perpendicular to the edge. */
export function sideOf(position: Point): Position {
  const dx = position.x - 0.5;
  const dy = position.y - 0.5;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy <= 0 ? Position.Top : Position.Bottom;
  }
  return dx <= 0 ? Position.Left : Position.Right;
}

const SIDE_NAME: Record<Position, string> = {
  [Position.Top]: "top",
  [Position.Right]: "right",
  [Position.Bottom]: "bottom",
  [Position.Left]: "left",
};

/**
 * A node connector. The dot is a React Flow handle, so dragging it draws a
 * connection; the dashed ring underneath is a separate grab handle used to
 * reposition the connector along the card perimeter.
 */
export function Connector({
  connector,
  nodeId,
  color = "#94a3b8",
  selected = false,
  onSelect,
  onMoveEnd,
  onContextMenu,
  movingPeers = [],
  selectingPeers = [],
  peerPosition = null,
  onMove,
  onMoveStart,
  onMoveFinished,
}: ConnectorProps) {
  const [dragging, setDragging] = useState(false);
  const [livePosition, setLivePosition] = useState<Point | null>(null);
  const [peerLive, setPeerLive] = useState<Point | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const movingPeer = movingPeers[0];
  const peerIndicator = movingPeer
    ? { user: movingPeer, state: "moving" as const }
    : selectingPeers[0]
      ? { user: selectingPeers[0], state: "selected" as const }
      : undefined;

  const position = livePosition ?? peerLive ?? { x: connector.x, y: connector.y };
  const side = sideOf(position);

  // A peer's drag arrives as a stream of targets; ease toward the newest one so
  // the connector glides, and re-measure so their links follow it.
  const peerTarget = useRef<Point | null>(null);
  const easedPeer = useRef<Point | null>(null);
  const peerFrame = useRef<number | null>(null);

  useEffect(() => {
    peerTarget.current = peerPosition;
    if (!peerPosition) {
      easedPeer.current = null;
      setPeerLive(null);
      return;
    }
    if (peerFrame.current !== null) return;

    const tick = () => {
      const target = peerTarget.current;
      if (!target) {
        peerFrame.current = null;
        return;
      }
      const from = easedPeer.current ?? target;
      const settled = Math.abs(target.x - from.x) < 0.001 && Math.abs(target.y - from.y) < 0.001;
      const next = settled
        ? target
        : {
            x: from.x + (target.x - from.x) * PEER_SMOOTHING,
            y: from.y + (target.y - from.y) * PEER_SMOOTHING,
          };
      easedPeer.current = next;
      setPeerLive(next);
      updateNodeInternals(nodeId);
      peerFrame.current = settled ? null : requestAnimationFrame(tick);
    };

    peerFrame.current = requestAnimationFrame(tick);
  }, [peerPosition, nodeId, updateNodeInternals]);

  useEffect(
    () => () => {
      if (peerFrame.current !== null) cancelAnimationFrame(peerFrame.current);
    },
    [],
  );

  const startReposition = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const rect = shell.current?.closest("[data-testid='node-card']")?.getBoundingClientRect();
      if (!rect) return;

      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      setDragging(true);
      onMoveStart?.();
      onMove?.({ x: connector.x, y: connector.y });
      let lastSent = performance.now();

      // Edges are measured from the handle's DOM box, so re-measure while the
      // connector moves; otherwise links would only catch up on release.
      let frame: number | null = null;
      const scheduleRemeasure = () => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          updateNodeInternals(nodeId);
        });
      };

      const move = (moveEvent: PointerEvent) => {
        const projected = projectToPerimeter(rect, moveEvent.clientX, moveEvent.clientY);
        const next = magnetize(projected, rect);
        setLivePosition(next);
        scheduleRemeasure();

        const now = performance.now();
        if (now - lastSent < MOVE_THROTTLE_MS) return;
        lastSent = now;
        onMove?.(next);
      };

      const up = (upEvent: PointerEvent) => {
        const projected = projectToPerimeter(rect, upEvent.clientX, upEvent.clientY);
        const finalPosition = magnetize(projected, rect);
        setLivePosition(null);
        setDragging(false);
        // Publish the exact drop position before peers fall back to the CRDT.
        onMove?.(finalPosition);
        onMoveEnd(connector.id, finalPosition);
        onMoveFinished?.();
        if (frame !== null) cancelAnimationFrame(frame);
        updateNodeInternals(nodeId);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [
      connector.id,
      connector.x,
      connector.y,
      nodeId,
      onMove,
      onMoveEnd,
      onMoveFinished,
      onMoveStart,
      updateNodeInternals,
    ],
  );

  return (
    <div
      ref={shell}
      data-testid="connector"
      data-connector-id={connector.id}
      data-selected={selected ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      data-anchored={isAnchor(position) ? "true" : "false"}
      data-side={SIDE_NAME[side]}
      data-peer={movingPeer ? "true" : undefined}
      data-peer-selected={peerIndicator ? "true" : undefined}
      className="nodrag nopan absolute z-20"
      style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
    >
      {peerIndicator ? (
        <span
          aria-hidden="true"
          data-state={peerIndicator.state}
          className="connector-peer-ring -translate-x-1/2 -translate-y-1/2"
          style={{ borderColor: peerIndicator.user.color }}
        />
      ) : null}

      {movingPeer ? (
        <PeerNameTag user={movingPeer} className="connector-peer-name -translate-y-1/2" />
      ) : null}

      {selected ? (
        <button
          type="button"
          aria-label="Move connector"
          data-testid="connector-grab"
          className="connector-grab -translate-x-1/2 -translate-y-1/2"
          style={{ borderColor: color }}
          onPointerDown={startReposition}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onContextMenu(event, connector.id);
          }}
        />
      ) : null}

      <Handle
        id={connector.id}
        type="source"
        position={side}
        data-testid="connector-dot"
        className="connector-dot"
        style={{
          left: 0,
          top: 0,
          transform: "translate(-50%, -50%)",
          borderColor: color,
          backgroundColor: selected ? color : undefined,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(connector.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event, connector.id);
        }}
      />
    </div>
  );
}
