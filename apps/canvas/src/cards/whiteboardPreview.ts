import type { DrawingElement } from "@suite/graph";

/** Longest side of the normalized preview; the other side keeps the aspect. */
const UNIT = 100;
const PADDING = 4;

export interface WhiteboardPreviewShape {
  key: string;
  kind: "rect" | "ellipse" | "diamond" | "polyline" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Array<{ x: number; y: number }>;
  text?: string;
  stroke: string;
  fill: string;
  strokeWidth: number;
}

export interface WhiteboardPreview {
  viewBox: { width: number; height: number };
  shapes: WhiteboardPreviewShape[];
  empty: boolean;
}

const EMPTY: WhiteboardPreview = {
  viewBox: { width: UNIT, height: (UNIT * 3) / 4 },
  shapes: [],
  empty: true,
};

function numberField(element: DrawingElement, key: string, fallback = 0): number {
  const value = element[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringField(element: DrawingElement, key: string, fallback: string): string {
  const value = element[key];
  return typeof value === "string" ? value : fallback;
}

function pointsOf(element: DrawingElement): Array<{ x: number; y: number }> | null {
  const points = element.points;
  if (!Array.isArray(points)) return null;
  const parsed: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number") {
      parsed.push({ x: point[0], y: point[1] });
      continue;
    }
    if (
      typeof point === "object" &&
      point !== null &&
      "x" in point &&
      "y" in point &&
      typeof point.x === "number" &&
      typeof point.y === "number"
    ) {
      parsed.push({ x: point.x, y: point.y });
    }
  }
  return parsed.length > 0 ? parsed : null;
}

function shapeKind(element: DrawingElement): WhiteboardPreviewShape["kind"] {
  const type = stringField(element, "type", "rectangle");
  if (type === "ellipse") return "ellipse";
  if (type === "diamond") return "diamond";
  if (type === "line" || type === "arrow" || type === "freedraw") return "polyline";
  if (type === "text") return "text";
  return "rect";
}

/**
 * A small, dependency-free drawing preview for the card face. It is not an
 * Excalidraw renderer: it keeps the geometry and the pair of colours a reader
 * needs to recognise the whiteboard at a glance, and leaves the real scene to
 * the focus surface.
 */
export function whiteboardPreview(elements: readonly DrawingElement[]): WhiteboardPreview {
  const live = elements.filter((element) => element.deletedAt === undefined);
  if (live.length === 0) return EMPTY;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of live) {
    const x = numberField(element, "x");
    const y = numberField(element, "y");
    const width = numberField(element, "width");
    const height = numberField(element, "height");
    minX = Math.min(minX, x, x + width);
    minY = Math.min(minY, y, y + height);
    maxX = Math.max(maxX, x, x + width);
    maxY = Math.max(maxY, y, y + height);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return EMPTY;

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const scale = (UNIT - PADDING * 2) / Math.max(width, height);
  const offsetX = PADDING + (UNIT - PADDING * 2 - width * scale) / 2;
  const offsetY = PADDING + (UNIT - PADDING * 2 - height * scale) / 2;
  const mapX = (value: number) => (value - minX) * scale + offsetX;
  const mapY = (value: number) => (value - minY) * scale + offsetY;

  const shapes: WhiteboardPreviewShape[] = [];
  for (const element of live) {
    const kind = shapeKind(element);
    const x = numberField(element, "x");
    const y = numberField(element, "y");
    const elementWidth = numberField(element, "width");
    const elementHeight = numberField(element, "height");
    const stroke = stringField(element, "strokeColor", "#1e1e1e");
    const fill = stringField(element, "backgroundColor", "transparent");
    const strokeWidth = Math.max(0.5, numberField(element, "strokeWidth", 1) * scale * 1.4);
    const points = pointsOf(element);
    const shape: WhiteboardPreviewShape = {
      key: stringField(element, "id", `shape-${shapes.length}`),
      kind,
      x: mapX(x),
      y: mapY(y),
      width: Math.max(elementWidth * scale, 0.5),
      height: Math.max(elementHeight * scale, 0.5),
      stroke,
      fill: fill === "transparent" ? "none" : fill,
      strokeWidth,
    };
    if (kind === "polyline" && points) {
      shape.points = points.map((point) => ({ x: mapX(x + point.x), y: mapY(y + point.y) }));
    }
    if (kind === "text") {
      shape.text = stringField(element, "text", "").slice(0, 80);
    }
    shapes.push(shape);
  }

  return {
    viewBox: { width: UNIT, height: UNIT },
    shapes,
    empty: shapes.length === 0,
  };
}
