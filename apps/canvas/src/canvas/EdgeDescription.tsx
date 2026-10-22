import type { GraphEdge } from "@suite/graph";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { PeerNameTag } from "../components/PeerNameTag";

/** Routing and label placement carried in `data`, so one component renders every style. */
export interface EdgeDescriptionData {
  path: GraphEdge["path"];
  /** Where the label sits along the path, 0..1. */
  labelOffset?: number | undefined;
  /** Reports a label being slid: `start`/`move` while dragging, `stop` to persist. */
  onLabelDrag?:
    | ((edgeId: string, offset: number, phase: "start" | "move" | "stop") => void)
    | undefined;
  /** Double-clicking the label opens the same editor as double-clicking the line. */
  onLabelEdit?: ((edgeId: string, point: { x: number; y: number }) => void) | undefined;
}

/** Points sampled when projecting a pointer onto the path. */
const SAMPLES = 48;

const PATHS: ReadonlySet<string> = new Set(["bezier", "straight", "step", "smoothstep"]);

function pathOf(data: unknown): GraphEdge["path"] {
  const path = (data as Partial<EdgeDescriptionData> | undefined)?.path;
  return typeof path === "string" && PATHS.has(path) ? (path as GraphEdge["path"]) : "bezier";
}

function labelOffsetOf(data: unknown): number {
  const offset = (data as Partial<EdgeDescriptionData> | undefined)?.labelOffset;
  return typeof offset === "number" && Number.isFinite(offset) ? clamp(offset) : 0.5;
}

function clamp(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}

/** One reusable element: `getPointAtLength` is the only curve maths needed here. */
let ruler: SVGPathElement | null = null;

function rulerFor(path: string): SVGPathElement | null {
  if (typeof document === "undefined") return null;
  ruler ??= document.createElementNS("http://www.w3.org/2000/svg", "path");
  ruler.setAttribute("d", path);
  return typeof ruler.getTotalLength === "function" ? ruler : null;
}

/** The point a fraction of the way along an SVG path, or null without geometry support. */
export function pointOnPath(path: string, fraction: number): { x: number; y: number } | null {
  const element = rulerFor(path);
  if (!element) return null;
  const total = element.getTotalLength();
  if (!Number.isFinite(total) || total <= 0) return null;
  const point = element.getPointAtLength(total * clamp(fraction));
  return { x: point.x, y: point.y };
}

/**
 * The fraction of the path closest to a point, so a dragged label slides along
 * the link instead of floating free of it. Sampled, then refined around the
 * best sample — enough precision for a chip a few pixels tall.
 */
export function nearestFractionOnPath(
  path: string,
  point: { x: number; y: number },
): number | null {
  const element = rulerFor(path);
  if (!element) return null;
  const total = element.getTotalLength();
  if (!Number.isFinite(total) || total <= 0) return null;

  const distanceAt = (fraction: number) => {
    const at = element.getPointAtLength(total * clamp(fraction));
    return Math.hypot(at.x - point.x, at.y - point.y);
  };

  let best = 0.5;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= SAMPLES; index += 1) {
    const fraction = index / SAMPLES;
    const distance = distanceAt(fraction);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = fraction;
    }
  }

  let step = 1 / SAMPLES;
  for (let pass = 0; pass < 6; pass += 1) {
    step /= 2;
    for (const candidate of [best - step, best + step]) {
      const fraction = clamp(candidate);
      const distance = distanceAt(fraction);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = fraction;
      }
    }
  }
  return best;
}

/** The peer currently sliding this edge's label, as one stable string. */
function useLabelDragger(edgeId: string): { name: string; color: string; offset: number } | null {
  const mark = usePresenceStore((state) => {
    for (const peer of Object.values(state.peers)) {
      const drag = peer.labelDrag;
      if (drag?.edgeId === edgeId) {
        return `${peer.clientId}\u0000${peer.user.color}\u0000${peer.user.name}\u0000${drag.offset}`;
      }
    }
    return "";
  });
  if (!mark) return null;
  const [, color = "", name = "", offset = "0.5"] = mark.split("\u0000");
  return { name, color, offset: Number(offset) };
}

/**
 * Renders a canvas link: the default path styles plus the description as an
 * HTML chip that floats just above the line wherever it is placed. The chip is
 * counter-scaled so it stays legible at any zoom, and can be slid along the
 * path — peers see it move in the dragger's colour.
 */
export function EdgeWithDescription({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  label,
  markerStart,
  markerEnd,
  style,
  interactionWidth,
  data,
}: EdgeProps) {
  const zoom = useStore((state) => state.transform[2]);
  const { screenToFlowPosition } = useReactFlow();
  const dragger = useLabelDragger(id);
  const [live, setLive] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const latest = useRef<number | null>(null);

  const [edgePath, midX, midY] = (() => {
    const points = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
    switch (pathOf(data)) {
      case "straight":
        return getStraightPath({ sourceX, sourceY, targetX, targetY });
      case "step":
        return getSmoothStepPath({ ...points, borderRadius: 0 });
      case "smoothstep":
        return getSmoothStepPath(points);
      default:
        return getBezierPath(points);
    }
  })();

  const onLabelDrag = (data as Partial<EdgeDescriptionData> | undefined)?.onLabelDrag;
  const onLabelEdit = (data as Partial<EdgeDescriptionData> | undefined)?.onLabelEdit;

  // Our own drag wins; otherwise a peer's live position, then the stored one.
  const offset = live ?? dragger?.offset ?? labelOffsetOf(data);
  const anchor = pointOnPath(edgePath, offset) ?? { x: midX, y: midY };
  const scale = 1 / (zoom || 1);
  // The chip is centred on the path point; its halo (CSS) is what opens the gap
  // in the line, so the stroke reads as running into the label.
  const chipX = anchor.x;
  const chipY = anchor.y;

  /** Fraction of the path under the pointer; null when it cannot be measured. */
  const fractionAt = (clientX: number, clientY: number): number | null => {
    const flow = screenToFlowPosition({ x: clientX, y: clientY });
    return nearestFractionOnPath(edgePath, flow);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerStart ? { markerStart } : {})}
        {...(markerEnd ? { markerEnd } : {})}
        {...(style ? { style } : {})}
        {...(interactionWidth === undefined ? {} : { interactionWidth })}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-description"
            data-testid="edge-description"
            style={{
              transform: `translate(${chipX}px, ${chipY}px) scale(${scale})`,
            }}
          >
            <button
              type="button"
              className="edge-description-chip"
              data-testid="edge-description-chip"
              data-dragging={live === null ? undefined : "true"}
              data-peer-name={dragger?.name}
              // The border carries the peer's colour; the text stays legible.
              {...(dragger ? { style: { borderColor: dragger.color } } : {})}
              title={`${label} — drag to move along the link`}
              onKeyDown={(event) => {
                // The keyboard path to the same editor a double click opens.
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onLabelEdit?.(id, { x: rect.left + rect.width / 2, y: rect.top });
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                // The chip sits over the canvas: without this a drag would pan
                // the board or start a selection box instead of moving the label.
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragging.current = fractionAt(event.clientX, event.clientY);
                latest.current = dragging.current;
                if (dragging.current !== null) onLabelDrag?.(id, dragging.current, "start");
              }}
              onPointerMove={(event) => {
                if (dragging.current === null) return;
                const fraction = fractionAt(event.clientX, event.clientY);
                if (fraction === null) return;
                latest.current = fraction;
                setLive(fraction);
                onLabelDrag?.(id, fraction, "move");
              }}
              onPointerUp={(event) => {
                if (dragging.current === null) return;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                const final = latest.current;
                dragging.current = null;
                latest.current = null;
                setLive(null);
                if (final !== null) onLabelDrag?.(id, final, "stop");
              }}
              onPointerCancel={() => {
                dragging.current = null;
                latest.current = null;
                setLive(null);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onLabelEdit?.(id, { x: event.clientX, y: event.clientY });
              }}
            >
              {label}
              {dragger ? (
                <span className="edge-description-peer" style={{ transform: `scale(${scale})` }}>
                  <PeerNameTag user={{ name: dragger.name, color: dragger.color }} />
                </span>
              ) : null}
            </button>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const edgeTypes = { description: EdgeWithDescription };

export interface EdgeDescriptionInputProps {
  /** Screen position of the gesture that opened the editor. */
  x: number;
  y: number;
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Inline editor for a link description, anchored where the user double-clicked.
 * Enter and a changed blur commit, Escape and an unchanged blur cancel.
 */
export function EdgeDescriptionInput({
  x,
  y,
  value,
  onCommit,
  onCancel,
}: EdgeDescriptionInputProps) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit && draft !== value) onCommit(draft);
    else onCancel();
  };

  return (
    <input
      ref={input}
      className="edge-description-input nodrag nopan"
      data-testid="edge-description-input"
      aria-label="Arrow description"
      placeholder="Describe this link…"
      value={draft}
      style={{ left: x, top: y }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          settle(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }
      }}
    />
  );
}
