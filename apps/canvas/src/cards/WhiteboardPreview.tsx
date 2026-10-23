import type { DrawingElement } from "@suite/graph";
import { useMemo } from "react";
import { whiteboardPreview } from "./whiteboardPreview";
import "../styles/whiteboard-preview.css";

export interface WhiteboardPreviewProps {
  elements: readonly DrawingElement[];
  /** Accessible name; defaults to a neutral whiteboard description. */
  label?: string;
  className?: string;
}

/** A lightweight SVG preview for a whiteboard card face. */
export function WhiteboardPreview({
  elements,
  label = "Whiteboard preview",
  className,
}: WhiteboardPreviewProps) {
  const preview = useMemo(() => whiteboardPreview(elements), [elements]);
  const { width, height } = preview.viewBox;

  return (
    <svg
      data-testid="whiteboard-preview"
      data-empty={preview.empty ? "true" : undefined}
      role="img"
      aria-label={label}
      className={`whiteboard-preview${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        className="whiteboard-preview__ground"
        x={0}
        y={0}
        width={width}
        height={height}
        rx={3}
      />
      {preview.shapes.map((shape) => {
        if (shape.kind === "ellipse") {
          return (
            <ellipse
              key={shape.key}
              cx={shape.x + shape.width / 2}
              cy={shape.y + shape.height / 2}
              rx={Math.max(shape.width / 2, 0.5)}
              ry={Math.max(shape.height / 2, 0.5)}
              fill={shape.fill}
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
            />
          );
        }
        if (shape.kind === "diamond") {
          return (
            <polygon
              key={shape.key}
              points={`${shape.x + shape.width / 2},${shape.y} ${shape.x + shape.width},${shape.y + shape.height / 2} ${shape.x + shape.width / 2},${shape.y + shape.height} ${shape.x},${shape.y + shape.height / 2}`}
              fill={shape.fill}
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
            />
          );
        }
        if (shape.kind === "polyline") {
          const points =
            shape.points && shape.points.length > 1
              ? shape.points.map((point) => `${point.x},${point.y}`).join(" ")
              : `${shape.x},${shape.y} ${shape.x + shape.width},${shape.y + shape.height}`;
          return (
            <polyline
              key={shape.key}
              points={points}
              fill="none"
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }
        if (shape.kind === "text") {
          return (
            <text
              key={shape.key}
              x={shape.x}
              y={shape.y + Math.max(shape.height, 6)}
              fill={shape.stroke}
              fontSize={Math.max(shape.height, 5)}
            >
              {shape.text ?? ""}
            </text>
          );
        }
        return (
          <rect
            key={shape.key}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={Math.min(2, shape.width / 8, shape.height / 8)}
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
          />
        );
      })}
      {preview.empty ? (
        <text
          className="whiteboard-preview__empty"
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          Empty whiteboard
        </text>
      ) : null}
    </svg>
  );
}
