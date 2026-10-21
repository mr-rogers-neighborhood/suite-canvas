import { CONNECTOR_ANCHORS, type Connector as ConnectorModel } from "@suite/graph";
import { Handle, Position } from "@xyflow/react";
import { useCallback, useRef, useState } from "react";

export interface ConnectorProps {
  connector: ConnectorModel;
  color?: string | undefined;
  selected?: boolean;
  onSelect: (connectorId: string) => void;
  /** Persisted once, on release, so dragging never writes to the CRDT per frame. */
  onMoveEnd: (connectorId: string, position: { x: number; y: number }) => void;
  onContextMenu: (event: React.MouseEvent, connectorId: string) => void;
}

/** Magnetic radius around a corner/side midpoint, in screen pixels. */
const MAGNET_RADIUS = 20;

interface Point {
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
 * A node connector. The dot is a React Flow handle, so dragging it draws a
 * connection; the dashed ring underneath is a separate grab handle used to
 * reposition the connector along the card perimeter.
 */
export function Connector({
  connector,
  color = "#94a3b8",
  selected = false,
  onSelect,
  onMoveEnd,
  onContextMenu,
}: ConnectorProps) {
  const [dragging, setDragging] = useState(false);
  const [livePosition, setLivePosition] = useState<Point | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);

  const position = livePosition ?? { x: connector.x, y: connector.y };

  const startReposition = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const rect = shell.current?.closest("[data-testid='node-card']")?.getBoundingClientRect();
      if (!rect) return;

      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      setDragging(true);

      const move = (moveEvent: PointerEvent) => {
        const projected = projectToPerimeter(rect, moveEvent.clientX, moveEvent.clientY);
        setLivePosition(magnetize(projected, rect));
      };

      const up = (upEvent: PointerEvent) => {
        const projected = projectToPerimeter(rect, upEvent.clientX, upEvent.clientY);
        const finalPosition = magnetize(projected, rect);
        setLivePosition(null);
        setDragging(false);
        onMoveEnd(connector.id, finalPosition);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [connector.id, onMoveEnd],
  );

  return (
    <div
      ref={shell}
      data-testid="connector"
      data-connector-id={connector.id}
      data-selected={selected ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      data-anchored={isAnchor(position) ? "true" : "false"}
      className="nodrag nopan absolute z-20"
      style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
    >
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
        position={Position.Top}
        data-testid="connector-dot"
        className="connector-dot -translate-x-1/2 -translate-y-1/2"
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
