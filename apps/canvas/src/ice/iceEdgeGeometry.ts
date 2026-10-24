/**
 * Edge geometry for the ICE canvas: the pure maths a GPU edge kind consumes.
 *
 * Cards live on Boards and Boards nest, but a Board's `rect` is expressed in its
 * parent's frame, so a card's world anchor is the sum of its ancestor frame
 * offsets, then its placement, then the connector fraction. Nothing here mounts
 * a surface: no DOM, no engine, no document.
 */

import type { EdgePath, Point, Rect } from "@suite/graph";

export type { EdgePath, Point, Rect } from "@suite/graph";

/** Mirrors `DEFAULT_CARD_WIDTH` in `canvas/multiSelect`; duplicated to stay dependency-free. */
export const DEFAULT_CARD_WIDTH = 288;
/** Mirrors `DEFAULT_CARD_HEIGHT` in `canvas/multiSelect`; duplicated to stay dependency-free. */
export const DEFAULT_CARD_HEIGHT = 240;

/** Sample count for curved paths when the caller does not ask for one. */
export const DEFAULT_EDGE_SAMPLES = 24;

const EPSILON = 1e-9;
const PARAMETER_TOLERANCE = 1e-6;
const POINT_TOLERANCE = 1e-6;
const MAX_SAMPLES = 1024;
const CORNER_RADIUS = 24;
const CORNER_ARC_SAMPLES = 8;

const BASE_THICKNESS = 2;
const MIN_THICKNESS = 0.75;
const MAX_THICKNESS = 3.5;
const BASE_OPACITY = 0.9;
const MIN_OPACITY = 0.28;
const DEPTH_FALLOFF = 0.32;
const ZOOM_MIN = 0.01;
const ZOOM_MAX = 100;

export interface EdgeConnector {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface EdgeEndInput {
  readonly placement: {
    readonly x: number;
    readonly y: number;
    readonly width?: number;
    readonly height?: number;
  };
  readonly connectors?: readonly EdgeConnector[];
  readonly connectorId?: string;
  /** Ancestor Board rects, root first, ending with the card's own Board. */
  readonly frames: readonly Rect[];
}

/**
 * A card's world anchor. Frame rects are frame-local, so their offsets are
 * cumulative: a card two Boards deep adds both origins before its placement.
 */
export function anchorWorld(end: EdgeEndInput): Point {
  let x = 0;
  let y = 0;
  for (const frame of end.frames) {
    x += frame.x;
    y += frame.y;
  }
  x += end.placement.x;
  y += end.placement.y;

  const width = end.placement.width ?? DEFAULT_CARD_WIDTH;
  const height = end.placement.height ?? DEFAULT_CARD_HEIGHT;
  const connector =
    end.connectorId === undefined
      ? undefined
      : end.connectors?.find((candidate) => candidate.id === end.connectorId);
  if (connector === undefined) {
    return { x: x + width / 2, y: y + height / 2 };
  }
  return {
    x: x + clampFraction(connector.x) * width,
    y: y + clampFraction(connector.y) * height,
  };
}

/** Index of the last board the two root-first paths share; 0 when only the root is shared. */
export function commonAncestorFrame(
  sourcePath: readonly string[],
  targetPath: readonly string[],
): number {
  const limit = Math.min(sourcePath.length, targetPath.length);
  let shared = 0;
  for (let index = 0; index < limit; index += 1) {
    if (sourcePath[index] !== targetPath[index]) break;
    shared = index;
  }
  return shared;
}

export interface EdgeRouteInput {
  readonly from: Point;
  readonly to: Point;
  readonly path: EdgePath;
  readonly samples?: number;
}

/**
 * A polyline for the edge. `straight` is the two endpoints, `step` is the
 * staircase's corner points, and `bezier`/`smoothstep` are resampled evenly
 * (by parameter for bezier, by arc length for smoothstep).
 */
export function routeEdge(input: EdgeRouteInput): readonly Point[] {
  const { from, to } = input;
  const count = sampleCount(input.samples);
  if (samePoint(from, to)) return [copyPoint(from), copyPoint(to)];

  switch (input.path) {
    case "straight":
      return [copyPoint(from), copyPoint(to)];
    case "step":
      return stepPoints(from, to);
    case "bezier":
      return bezierPoints(from, to, count);
    case "smoothstep":
      return resamplePolyline(roundedStaircase(stepPoints(from, to)), count);
  }
}

export interface FrameDepth {
  readonly rect: Rect;
  readonly depth: number;
}

export interface Seam {
  readonly index: number;
  readonly t: number;
  readonly point: Point;
  readonly normal: Point;
  readonly depth: number;
}

/**
 * Every border crossing of `polyline` through `frames`, ordered along the path.
 * The normal always points out of the crossed frame, so an edge leaving a Board
 * and an edge entering it report the same side.
 */
export function seamsOf(
  polyline: readonly Point[],
  frames: readonly FrameDepth[],
): readonly Seam[] {
  if (polyline.length < 2 || frames.length === 0) return [];

  const seams: Seam[] = [];
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const from = polyline[index];
    const to = polyline[index + 1];
    if (from === undefined || to === undefined) continue;
    const delta = { x: to.x - from.x, y: to.y - from.y };
    if (Math.abs(delta.x) <= EPSILON && Math.abs(delta.y) <= EPSILON) continue;
    const lastSegment = index === polyline.length - 2;

    for (const frame of frames) {
      const groups = groupHits(borderHits(from, to, frame.rect), index, lastSegment);
      for (const group of groups) {
        const head = group[0];
        if (head === undefined) continue;
        const t = clamp01(head.t);
        seams.push({
          index,
          t,
          point: { x: from.x + t * delta.x, y: from.y + t * delta.y },
          normal: normalFor(group, delta),
          depth: frame.depth,
        });
      }
    }
  }

  seams.sort((left, right) => left.index - right.index || left.t - right.t);
  return dedupeSeams(seams);
}

/** How many levels deeper the target sits than the source; negative when it is shallower. */
export function depthDelta(sourceDepth: number, targetDepth: number): number {
  const source = Number.isFinite(sourceDepth) ? sourceDepth : 0;
  const target = Number.isFinite(targetDepth) ? targetDepth : 0;
  return target - source;
}

/** Screen-space weight for an edge: a deeper target reads thinner and fainter. */
export function edgeRender(delta: number, zoom: number): { thickness: number; opacity: number } {
  const depth = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const safeZoom = Number.isFinite(zoom) ? clamp(zoom, ZOOM_MIN, ZOOM_MAX) : 1;
  const depthScale = 1 / (1 + depth * DEPTH_FALLOFF);
  const zoomScale = safeZoom ** 0.18;
  return {
    thickness: clamp(BASE_THICKNESS * depthScale * zoomScale, MIN_THICKNESS, MAX_THICKNESS),
    opacity: clamp(BASE_OPACITY * (0.62 + 0.38 * depthScale), MIN_OPACITY, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clampFraction(value: number): number {
  return Number.isFinite(value) ? clamp01(value) : 0;
}

function copyPoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function sampleCount(samples: number | undefined): number {
  if (samples === undefined || !Number.isFinite(samples)) return DEFAULT_EDGE_SAMPLES;
  return clamp(Math.floor(samples), 2, MAX_SAMPLES);
}

function stepPoints(from: Point, to: Point): Point[] {
  if (from.y === to.y || from.x === to.x) return [copyPoint(from), copyPoint(to)];
  const middle = (from.x + to.x) / 2;
  return [copyPoint(from), { x: middle, y: from.y }, { x: middle, y: to.y }, copyPoint(to)];
}

function bezierPoints(from: Point, to: Point, count: number): Point[] {
  // Horizontal handles sized by half the horizontal span: the classic edge curve.
  const handle = (to.x - from.x) / 2;
  const controlA = { x: from.x + handle, y: from.y };
  const controlB = { x: to.x - handle, y: to.y };
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const inverse = 1 - t;
    points.push({
      x:
        inverse ** 3 * from.x +
        3 * inverse ** 2 * t * controlA.x +
        3 * inverse * t ** 2 * controlB.x +
        t ** 3 * to.x,
      y:
        inverse ** 3 * from.y +
        3 * inverse ** 2 * t * controlA.y +
        3 * inverse * t ** 2 * controlB.y +
        t ** 3 * to.y,
    });
  }
  return points;
}

function roundedStaircase(sharp: readonly Point[]): Point[] {
  if (sharp.length <= 2) return sharp.map(copyPoint);

  const rounded: Point[] = [];
  const first = sharp[0];
  if (first !== undefined) rounded.push(copyPoint(first));

  for (let index = 1; index < sharp.length - 1; index += 1) {
    const previous = sharp[index - 1];
    const corner = sharp[index];
    const next = sharp[index + 1];
    if (previous === undefined || corner === undefined || next === undefined) continue;
    const radius = Math.min(distance(previous, corner), distance(corner, next)) / 2;
    if (radius <= EPSILON) {
      pushDistinct(rounded, corner);
      continue;
    }
    const reach = Math.min(radius, CORNER_RADIUS);
    const start = pointTowards(corner, previous, reach);
    const end = pointTowards(corner, next, reach);
    for (let step = 0; step <= CORNER_ARC_SAMPLES; step += 1) {
      pushDistinct(rounded, quadraticAt(start, corner, end, step / CORNER_ARC_SAMPLES));
    }
  }

  const last = sharp[sharp.length - 1];
  if (last !== undefined) pushDistinct(rounded, last);
  return rounded;
}

function pointTowards(from: Point, to: Point, distanceAway: number): Point {
  const total = distance(from, to);
  if (total <= EPSILON) return copyPoint(from);
  const ratio = Math.min(1, distanceAway / total);
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

function quadraticAt(start: Point, control: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse ** 2 * start.x + 2 * inverse * t * control.x + t ** 2 * end.x,
    y: inverse ** 2 * start.y + 2 * inverse * t * control.y + t ** 2 * end.y,
  };
}

function pushDistinct(points: Point[], point: Point): void {
  const previous = points[points.length - 1];
  if (
    previous !== undefined &&
    Math.abs(previous.x - point.x) <= EPSILON &&
    Math.abs(previous.y - point.y) <= EPSILON
  ) {
    return;
  }
  points.push(copyPoint(point));
}

function resamplePolyline(points: readonly Point[], count: number): Point[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [];

  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = a === undefined || b === undefined ? 0 : distance(a, b);
    lengths.push(length);
    total += length;
  }
  if (total <= EPSILON) return [copyPoint(first), copyPoint(last)];

  const result: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      result.push(copyPoint(first));
      continue;
    }
    if (index === count - 1) {
      result.push(copyPoint(last));
      continue;
    }
    const target = (total * index) / (count - 1);
    let segment = 0;
    let travelled = 0;
    while (segment < lengths.length - 1 && travelled + (lengths[segment] ?? 0) < target) {
      travelled += lengths[segment] ?? 0;
      segment += 1;
    }
    const a = points[segment];
    const b = points[segment + 1];
    const length = lengths[segment] ?? 0;
    if (a === undefined || b === undefined || length <= EPSILON) {
      result.push(a === undefined ? copyPoint(first) : copyPoint(a));
      continue;
    }
    const ratio = clamp01((target - travelled) / length);
    result.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
  }
  return result;
}

interface BorderHit {
  readonly t: number;
  readonly normal: Point;
}

function borderHits(from: Point, to: Point, rect: Rect): BorderHit[] {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  const hits: BorderHit[] = [];

  if (Math.abs(deltaX) > EPSILON) {
    const verticals: readonly (readonly [number, number])[] = [
      [minX, -1],
      [maxX, 1],
    ];
    for (const [edgeX, normalX] of verticals) {
      const t = (edgeX - from.x) / deltaX;
      if (t < -EPSILON || t > 1 + EPSILON) continue;
      const y = from.y + t * deltaY;
      if (y < minY - EPSILON || y > maxY + EPSILON) continue;
      hits.push({ t, normal: { x: normalX, y: 0 } });
    }
  }

  if (Math.abs(deltaY) > EPSILON) {
    const horizontals: readonly (readonly [number, number])[] = [
      [minY, -1],
      [maxY, 1],
    ];
    for (const [edgeY, normalY] of horizontals) {
      const t = (edgeY - from.y) / deltaY;
      if (t < -EPSILON || t > 1 + EPSILON) continue;
      const x = from.x + t * deltaX;
      if (x < minX - EPSILON || x > maxX + EPSILON) continue;
      hits.push({ t, normal: { x: 0, y: normalY } });
    }
  }

  return hits;
}

/**
 * Half-open segment ranges count a border-touching vertex once: at the start of
 * the next segment, never again at the end of the previous one.
 */
function groupHits(hits: readonly BorderHit[], index: number, lastSegment: boolean): BorderHit[][] {
  const groups: BorderHit[][] = [];
  const sorted = [...hits].sort((left, right) => left.t - right.t);
  for (const hit of sorted) {
    if (index === 0 && hit.t <= EPSILON) continue;
    if (!lastSegment && hit.t >= 1 - EPSILON) continue;
    const group = groups[groups.length - 1];
    const head = group?.[0];
    if (
      group !== undefined &&
      head !== undefined &&
      Math.abs(head.t - hit.t) <= PARAMETER_TOLERANCE
    ) {
      group.push(hit);
    } else {
      groups.push([hit]);
    }
  }
  return groups;
}

/** At a corner both borders are hit; the one the path actually leaves through wins. */
function normalFor(hits: readonly BorderHit[], direction: Point): Point {
  const first = hits[0];
  if (first === undefined) return { x: 0, y: 0 };
  let best = first.normal;
  let bestDot = first.normal.x * direction.x + first.normal.y * direction.y;
  for (const hit of hits.slice(1)) {
    const dot = hit.normal.x * direction.x + hit.normal.y * direction.y;
    if (dot > bestDot + EPSILON) {
      best = hit.normal;
      bestDot = dot;
    }
  }
  return { x: best.x, y: best.y };
}

function dedupeSeams(seams: readonly Seam[]): Seam[] {
  const result: Seam[] = [];
  for (const seam of seams) {
    const previous = result[result.length - 1];
    if (
      previous !== undefined &&
      previous.depth === seam.depth &&
      Math.abs(previous.point.x - seam.point.x) <= POINT_TOLERANCE &&
      Math.abs(previous.point.y - seam.point.y) <= POINT_TOLERANCE
    ) {
      continue;
    }
    result.push(seam);
  }
  return result;
}
