import type { GraphEdge } from "@suite/graph";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useStore,
} from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

/** Routing carried in `data`, so one edge component can render every path style. */
export interface EdgeDescriptionData {
  path: GraphEdge["path"];
}

const PATHS: ReadonlySet<string> = new Set(["bezier", "straight", "step", "smoothstep"]);

function pathOf(data: unknown): GraphEdge["path"] {
  const path = (data as Partial<EdgeDescriptionData> | undefined)?.path;
  return typeof path === "string" && PATHS.has(path) ? (path as GraphEdge["path"]) : "bezier";
}

/**
 * Renders a canvas link: the default path styles plus the description as an
 * HTML chip. The chip lives in React Flow's label renderer so it can be
 * truncated with CSS, and it is counter-scaled so it stays legible at any zoom.
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

  const [edgePath, labelX, labelY] = (() => {
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
              transform: `translate(${labelX}px, ${labelY}px) scale(${1 / (zoom || 1)})`,
            }}
          >
            <span className="edge-description-chip">{label}</span>
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
