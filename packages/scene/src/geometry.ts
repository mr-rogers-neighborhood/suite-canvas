import type { Camera, Point, Rect, Size, Transform } from "./types.js";

/** Sub-pixel slack so touching edges do not read as overlap. */
export const GEOMETRY_EPSILON = 1e-6;

export const IDENTITY_TRANSFORM: Transform = { scale: 1, x: 0, y: 0 };

export function point(x: number, y: number): Point {
  return { x, y };
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function rectCenter(value: Rect): Point {
  return { x: value.x + value.width / 2, y: value.y + value.height / 2 };
}

export function rectArea(value: Rect): number {
  return value.width * value.height;
}

export function rectMaxX(value: Rect): number {
  return value.x + value.width;
}

export function rectMaxY(value: Rect): number {
  return value.y + value.height;
}

export function rectTranslate(value: Rect, dx: number, dy: number): Rect {
  return { x: value.x + dx, y: value.y + dy, width: value.width, height: value.height };
}

export function rectUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(rectMaxX(a), rectMaxX(b)) - x,
    height: Math.max(rectMaxY(a), rectMaxY(b)) - y,
  };
}

/** Null when there is nothing to union, so callers decide on a fallback box. */
export function rectUnionAll(rects: readonly Rect[]): Rect | null {
  const [first, ...rest] = rects;
  if (!first) return null;
  let result = first;
  for (const item of rest) result = rectUnion(result, item);
  return result;
}

/** Null when the rectangles only touch or are apart. */
export function rectIntersection(a: Rect, b: Rect, tolerance = 0): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const maxX = Math.min(rectMaxX(a), rectMaxX(b));
  const maxY = Math.min(rectMaxY(a), rectMaxY(b));
  if (maxX - x <= tolerance || maxY - y <= tolerance) return null;
  return { x, y, width: maxX - x, height: maxY - y };
}

export function rectIntersects(a: Rect, b: Rect, tolerance = 0): boolean {
  return rectIntersection(a, b, tolerance) !== null;
}

export function rectContainsPoint(value: Rect, target: Point, tolerance = 0): boolean {
  return (
    target.x >= value.x - tolerance &&
    target.x <= rectMaxX(value) + tolerance &&
    target.y >= value.y - tolerance &&
    target.y <= rectMaxY(value) + tolerance
  );
}

/** Full containment with `tolerance` slack on both sides. */
export function rectContainsRect(outer: Rect, inner: Rect, tolerance = 0): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    rectMaxX(inner) <= rectMaxX(outer) + tolerance &&
    rectMaxY(inner) <= rectMaxY(outer) + tolerance
  );
}

export function rectEquals(a: Rect, b: Rect, tolerance = GEOMETRY_EPSILON): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

export function rectScale(value: Rect, scale: number): Rect {
  return {
    x: value.x * scale,
    y: value.y * scale,
    width: value.width * scale,
    height: value.height * scale,
  };
}

/** Intersection area; 0 when the rectangles are apart. */
export function rectOverlapArea(a: Rect, b: Rect): number {
  const overlap = rectIntersection(a, b);
  return overlap ? rectArea(overlap) : 0;
}

/* --------------------------------------------------------------- transforms */

export function composeTransform(outer: Transform, inner: Transform): Transform {
  return {
    scale: outer.scale * inner.scale,
    x: outer.x + outer.scale * inner.x,
    y: outer.y + outer.scale * inner.y,
  };
}

/** Null for a degenerate (zero-scale) transform; every scene transform is non-zero. */
export function invertTransform(value: Transform): Transform | null {
  if (!Number.isFinite(value.scale) || Math.abs(value.scale) < GEOMETRY_EPSILON) return null;
  const scale = 1 / value.scale;
  return { scale, x: -value.x * scale, y: -value.y * scale };
}

export function transformPoint(value: Transform, target: Point): Point {
  return { x: target.x * value.scale + value.x, y: target.y * value.scale + value.y };
}

export function inverseTransformPoint(value: Transform, target: Point): Point | null {
  const inverted = invertTransform(value);
  return inverted ? transformPoint(inverted, target) : null;
}

/** Bounds of a board rect in page space; scale is assumed positive. */
export function transformRect(value: Transform, target: Rect): Rect {
  return {
    x: target.x * value.scale + value.x,
    y: target.y * value.scale + value.y,
    width: target.width * value.scale,
    height: target.height * value.scale,
  };
}

/** Scale that fits `bounds` into a frame, multiplied by `padding`. */
export function fitScale(bounds: Size, frame: Size, padding = 1): number {
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    !Number.isFinite(padding) ||
    padding <= 0
  ) {
    return 0;
  }
  return Math.min(frame.width / bounds.width, frame.height / bounds.height) * padding;
}

/**
 * Transform that centres `bounds` inside `frame` (both in the same coordinate
 * space) and maps bounds coordinates into that space.
 */
export function fitTransform(bounds: Rect, frame: Rect, padding = 1): Transform {
  const scale = fitScale(bounds, frame, padding);
  const scaledWidth = bounds.width * scale;
  const scaledHeight = bounds.height * scale;
  return {
    scale,
    x: frame.x + (frame.width - scaledWidth) / 2 - bounds.x * scale,
    y: frame.y + (frame.height - scaledHeight) / 2 - bounds.y * scale,
  };
}

/* ------------------------------------------------------------------ camera */

function cameraZoom(camera: Camera): number {
  return camera.zoom > 0 && Number.isFinite(camera.zoom) ? camera.zoom : 1;
}

/** Camera zoom multiplied by every ancestor board scale. */
export function effectiveScale(camera: Camera, transform?: Transform): number {
  return cameraZoom(camera) * (transform?.scale ?? 1);
}

export function pageToScreen(camera: Camera, target: Point): Point {
  const zoom = cameraZoom(camera);
  return { x: target.x * zoom + camera.x, y: target.y * zoom + camera.y };
}

export function screenToPage(camera: Camera, target: Point): Point {
  const zoom = cameraZoom(camera);
  return { x: (target.x - camera.x) / zoom, y: (target.y - camera.y) / zoom };
}

/** The only board conversion the surface needs: screen -> one board's flow space. */
export function screenToBoard(camera: Camera, transform: Transform, target: Point): Point {
  return inverseTransformPoint(transform, screenToPage(camera, target)) ?? target;
}

export function boardToScreen(camera: Camera, transform: Transform, target: Point): Point {
  return pageToScreen(camera, transformPoint(transform, target));
}
