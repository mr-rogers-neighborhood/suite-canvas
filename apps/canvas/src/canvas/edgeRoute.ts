/**
 * Route geometry for links: the pure half of ADR-0052 ("a link is a route").
 *
 * A route is two anchors, an optional polyline of bends stored *relative to the
 * source anchor*, and a path mode. Nothing here touches React, Loro or the DOM,
 * so the edge component, section links and tests all get the same answer.
 */

import type { GraphEdge } from "@suite/graph";

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RouteMode = "bezier" | "straight" | "step" | "smoothstep" | "avoid";

const ROUTE_MODES: ReadonlySet<string> = new Set<RouteMode>([
  "bezier",
  "straight",
  "step",
  "smoothstep",
  "avoid",
]);

/**
 * A mode read off a stored edge. Anything unrecognised falls back to `bezier`,
 * so a document written by a newer client still draws (ADR-0052 §6: the
 * documented fallback, never a crash).
 */
export function asRouteMode(value: unknown): RouteMode {
  return typeof value === "string" && ROUTE_MODES.has(value) ? (value as RouteMode) : "bezier";
}

/** Corner radius for the rounded joins, in flow units. */
const CORNER_RADIUS = 12;
/** Router grid resolution, in flow units. */
const GRID_CELL = 24;
const DEFAULT_MARGIN = 48;
const DEFAULT_BUDGET = 4000;
const EPSILON = 1e-6;
/** A routed segment is axis-aligned or an exact diagonal; anything else is a bend. */
const ROUTED_ANGLE_TOLERANCE = 0.5;

const NEIGHBOURS = [
  { dc: 1, dr: 0, cost: 1, diagonal: false },
  { dc: -1, dr: 0, cost: 1, diagonal: false },
  { dc: 0, dr: 1, cost: 1, diagonal: false },
  { dc: 0, dr: -1, cost: 1, diagonal: false },
  { dc: 1, dr: 1, cost: Math.SQRT2, diagonal: true },
  { dc: 1, dr: -1, cost: Math.SQRT2, diagonal: true },
  { dc: -1, dr: 1, cost: Math.SQRT2, diagonal: true },
  { dc: -1, dr: -1, cost: Math.SQRT2, diagonal: true },
] as const;

/** Bends are stored relative to the source anchor, so a moved card takes them along. */
export function absoluteBends(
  source: RoutePoint,
  bends: readonly RoutePoint[] | undefined,
): RoutePoint[] {
  if (!bends) return [];
  const points: RoutePoint[] = [];
  for (const bend of bends) {
    // A bend that cannot be placed is dropped rather than drawn at the origin.
    if (!Number.isFinite(bend.x) || !Number.isFinite(bend.y)) continue;
    points.push({ x: source.x + bend.x, y: source.y + bend.y });
  }
  return points;
}

/** The ordered points the route passes through: source, bends…, target. */
export function routePoints(
  source: RoutePoint,
  target: RoutePoint,
  bends?: readonly RoutePoint[],
): RoutePoint[] {
  const points: RoutePoint[] = [source];
  for (const bend of absoluteBends(source, bends)) appendUnique(points, bend);
  appendUnique(points, target);
  // A collapsed link still carries two points so callers can assume a segment.
  if (points.length === 1) points.push({ x: target.x, y: target.y });
  return points;
}

/** An SVG path through the points, in the requested mode. Bends always win over `avoid`. */
export function routePath(points: readonly RoutePoint[], mode: RouteMode): string {
  const clean = dedupe(points);
  const first = clean[0];
  if (!first) return "";
  if (clean.length === 1) return `M ${format(first.x)} ${format(first.y)}`;

  switch (mode) {
    case "straight":
      return polyline(clean);
    case "step":
      return polyline(stepPoints(clean));
    case "smoothstep":
      return rounded(stepPoints(clean));
    case "bezier":
      return bezier(clean);
    case "avoid":
      // `avoid` cannot see the bend list, only the points it became. Router
      // output is always axis-aligned or diagonal, so that is the tell: a route
      // with a hand-placed bend is drawn sharp, as the decision requires.
      return looksRouted(clean) ? rounded(clean) : polyline(clean);
    default:
      return polyline(clean);
  }
}

/** True when the route was routed around obstacles rather than drawn as asked. */
export function isAvoidMode(mode: RouteMode): boolean {
  return mode === "avoid";
}

/* ------------------------------------------------------------ reverse pairs */

/** How far a paired link bows away from the straight line, in flow units. */
const PAIR_BOW_MIN = 4;
const PAIR_BOW_MAX = 10;

/** FNV-1a over the id, mapped to 0..1: the same number on every client, forever. */
function hashFraction(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * The sideways nudge that keeps a reverse pair legible (ADR-0052 §5).
 *
 * The rule, and it is the whole rule: **a paired link bows to the left of its
 * own travel, by 4–10 flow units chosen by its own id.** Two links between the
 * same connectors travel in opposite directions, so they always land on opposite
 * sides of the line between the dots, and the pair never overlaps. The magnitude
 * is a hash of the edge id, so every client computes the same offset from the
 * document alone — never from a peer, a clock or a random seed, and never from
 * the other link (that would make an unrelated line move).
 *
 * Only applied when a reverse partner actually exists; a lone link keeps the
 * geometry it has always had.
 */
export function pairOffset(edgeId: string, source: RoutePoint, target: RoutePoint): RoutePoint {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < EPSILON) return { x: 0, y: 0 };
  const magnitude = PAIR_BOW_MIN + hashFraction(edgeId) * (PAIR_BOW_MAX - PAIR_BOW_MIN);
  // Left of travel is (-dy, dx) on a y-down canvas.
  return { x: (-dy / length) * magnitude, y: (dx / length) * magnitude };
}

/**
 * Nudges a route sideways: interior points move, and a route with no interior
 * gains one at its midpoint — the bow that separates a two-point link from its
 * twin. The endpoints stay on their dots.
 */
export function shiftRoute(points: readonly RoutePoint[], offset: RoutePoint): RoutePoint[] {
  const moved = points.map((point) => ({ x: point.x, y: point.y }));
  if (offset.x === 0 && offset.y === 0) return moved;
  const first = moved[0];
  const last = moved[moved.length - 1];
  if (!first || !last) return moved;
  if (moved.length > 2) {
    return moved.map((point, index) =>
      index === 0 || index === moved.length - 1
        ? point
        : { x: point.x + offset.x, y: point.y + offset.y },
    );
  }
  return [
    first,
    { x: (first.x + last.x) / 2 + offset.x, y: (first.y + last.y) / 2 + offset.y },
    last,
  ];
}

/** A card's box in flow units: what a self-loop has to travel around. */
export interface LoopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far outside the card a self-loop bows. Wide enough to clear a card's shadow. */
export const SELF_LOOP_MARGIN = 28;

/**
 * A link that leaves a card and comes back to it
 * ([ADR-0061](./0061-three-ways-to-draw-links.md) amendment).
 *
 * Threading is a route *through* a card, so `A.top → A.bottom` is a real edge —
 * `addEdge` accepts it and the reference index counts it. The plain route between
 * those two anchors, however, is a line straight across the card face: it reads as
 * a stripe painted on the card, not as a line that left and returned.
 *
 * So the loop bows out to one side and comes back. The side is decided by the
 * anchors: it bows outward on the side they already sit, so the line never has to
 * cross the card to reach its own bow. A vertical pair (top and bottom) bows right
 * or left depending on where the dots are; a horizontal pair bows down or up. The
 * axis the anchors span is the axis the loop *leaves* by, and the bow grows on the
 * other one.
 *
 * Returns `null` when the two anchors are the same point, which a thread never
 * produces (clicking the armed connector disarms instead) but a hand-edited
 * document could.
 */
export function selfLoopRoute(
  source: RoutePoint,
  target: RoutePoint,
  rect: LoopRect,
  margin: number = SELF_LOOP_MARGIN,
): RoutePoint[] | null {
  if (source.x === target.x && source.y === target.y) return null;

  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  // Which way the anchors lie from the centre tells us the axis they span; the loop
  // bulges on the other one.
  const spansVertically = Math.abs(source.y - target.y) >= Math.abs(source.x - target.x);
  if (spansVertically) {
    // Bow outward on the side the anchors already sit, so the loop never crosses the
    // card to reach its own bow: dots on the right edge loop further right.
    const outward = (source.x + target.x) / 2 >= centre.x ? 1 : -1;
    const lane = outward >= 0 ? rect.x + rect.width + margin : rect.x - margin;
    return [source, { x: lane, y: source.y }, { x: lane, y: target.y }, target];
  }
  const outward = (source.y + target.y) / 2 >= centre.y ? 1 : -1;
  const lane = outward >= 0 ? rect.y + rect.height + margin : rect.y - margin;
  return [source, { x: source.x, y: lane }, { x: target.x, y: lane }, target];
}

/** One end of a link as the pair rule compares it: kind, entity and dot. */
function endKey(edge: GraphEdge, end: "source" | "target"): string {
  const kind = end === "source" ? edge.sourceKind : edge.targetKind;
  const connector = end === "source" ? edge.sourceConnector : edge.targetConnector;
  return `${kind ?? "card"}|${end === "source" ? edge.source : edge.target}|${connector ?? ""}`;
}

/**
 * The link that runs the same two dots the other way, if there is one. This is
 * document data — the same answer everywhere — which is why the pair offset only
 * turns on for links that have one, and a lone link stays exactly where it was.
 */
export function reversePartnerOf(
  edge: GraphEdge,
  edges: readonly GraphEdge[],
): GraphEdge | undefined {
  const source = endKey(edge, "source");
  const target = endKey(edge, "target");
  if (source === target) return undefined;
  return edges.find(
    (other) =>
      other.id !== edge.id &&
      other.boardId === edge.boardId &&
      endKey(other, "source") === target &&
      endKey(other, "target") === source,
  );
}

/**
 * Opt-in obstacle avoidance. Returns the polyline to draw (source + waypoints + target) or null when
 * it cannot help: null means the caller renders `bezier`, which is the documented fallback.
 */
export function avoidRoute(
  source: RoutePoint,
  target: RoutePoint,
  obstacles: readonly RouteRect[],
  options?: { margin?: number; budget?: number },
): RoutePoint[] | null {
  const margin = options?.margin ?? DEFAULT_MARGIN;
  const budget = options?.budget ?? DEFAULT_BUDGET;
  // An obstacle that holds an anchor is the card the link leaves from or enters:
  // routing around it would mean routing around the link's own end. Anchors sit
  // on the border, so the containment test is inclusive.
  const usable = obstacles.filter(
    (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      !containsPoint(rect, source) &&
      !containsPoint(rect, target),
  );
  // Obstacles are inflated by half the margin so the line keeps its distance.
  const inflated = usable.map((rect) => inflate(rect, margin / 2));

  // The common case is a clear line: say so, and the caller keeps the bezier.
  if (!inflated.some((rect) => segmentHitsRect(source, target, rect))) return null;

  const grid = buildGrid(source, target, inflated, margin);
  const startIndex = cellIndex(grid, source);
  const goalIndex = cellIndex(grid, target);
  if (startIndex < 0 || goalIndex < 0) return null;

  const route = search(grid, startIndex, goalIndex, source, target, budget);
  if (!route || route.length < 2) return null;
  return simplify(route);
}

/* ------------------------------------------------------------------ paths */

/** Numbers in a path are rounded so the string stays readable and comparable. */
function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function dedupe(points: readonly RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const point of points) appendUnique(out, point);
  return out;
}

function appendUnique(points: RoutePoint[], point: RoutePoint): void {
  const last = points[points.length - 1];
  if (last && last.x === point.x && last.y === point.y) return;
  points.push(point);
}

function polyline(points: readonly RoutePoint[]): string {
  const parts: string[] = [];
  for (const point of points) {
    parts.push(`${parts.length === 0 ? "M" : "L"} ${format(point.x)} ${format(point.y)}`);
  }
  return parts.join(" ");
}

/**
 * Right angles between consecutive points: the elbow goes horizontally first,
 * through the target's x, so every segment is axis-aligned.
 */
function stepPoints(points: readonly RoutePoint[]): RoutePoint[] {
  const first = points[0];
  if (!first) return [];
  const out: RoutePoint[] = [first];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    if (from.x !== to.x && from.y !== to.y) out.push({ x: to.x, y: from.y });
    out.push(to);
  }
  return dedupe(out);
}

/** Corner rounding: a short straight run into the corner, then a quadratic through it. */
function rounded(points: readonly RoutePoint[]): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 2) return polyline(points);

  const parts = [`M ${format(first.x)} ${format(first.y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    if (!previous || !corner || !next) continue;
    const radius = Math.min(
      CORNER_RADIUS,
      distance(previous, corner) / 2,
      distance(corner, next) / 2,
    );
    if (radius < 0.5) {
      parts.push(`L ${format(corner.x)} ${format(corner.y)}`);
      continue;
    }
    const before = towards(corner, previous, radius);
    const after = towards(corner, next, radius);
    parts.push(
      `L ${format(before.x)} ${format(before.y)}`,
      `Q ${format(corner.x)} ${format(corner.y)} ${format(after.x)} ${format(after.y)}`,
    );
  }
  const last = points[points.length - 1];
  if (last) parts.push(`L ${format(last.x)} ${format(last.y)}`);
  return parts.join(" ");
}

/**
 * A curve through every point: Catmull-Rom tangents converted to cubic Bézier
 * controls, so a bend is always on the line rather than near it.
 */
function bezier(points: readonly RoutePoint[]): string {
  const first = points[0];
  if (!first) return "";
  const parts = [`M ${format(first.x)} ${format(first.y)}`];

  // Two points keep the gentle horizontal curve the app already draws.
  if (points.length === 2) {
    const last = points[1];
    if (!last) return parts.join(" ");
    const reach = Math.max(20, Math.abs(last.x - first.x) * 0.2);
    parts.push(
      `C ${format(first.x + reach)} ${format(first.y)} ${format(last.x - reach)} ${format(last.y)} ${format(last.x)} ${format(last.y)}`,
    );
    return parts.join(" ");
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) continue;
    const before = points[index - 1] ?? from;
    const after = points[index + 2] ?? to;
    const control1 = { x: from.x + (to.x - before.x) / 6, y: from.y + (to.y - before.y) / 6 };
    const control2 = { x: to.x - (after.x - from.x) / 6, y: to.y - (after.y - from.y) / 6 };
    parts.push(
      `C ${format(control1.x)} ${format(control1.y)} ${format(control2.x)} ${format(control2.y)} ${format(to.x)} ${format(to.y)}`,
    );
  }
  return parts.join(" ");
}

/**
 * Router output runs along cell axes or exact diagonals. Only its first and last
 * segments — the stubs from each anchor to the grid — can leave at any angle, so
 * a longer polyline is judged on the segments between those stubs.
 */
function looksRouted(points: readonly RoutePoint[]): boolean {
  const skip = points.length > 3 ? 1 : 0;
  for (let index = skip + 1; index < points.length - skip; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const axisAligned = dx <= ROUTED_ANGLE_TOLERANCE || dy <= ROUTED_ANGLE_TOLERANCE;
    const diagonal = Math.abs(dx - dy) <= ROUTED_ANGLE_TOLERANCE;
    if (!axisAligned && !diagonal) return false;
  }
  return true;
}

function distance(a: RoutePoint, b: RoutePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** `radius` along the line from `from` towards `to`; callers pre-clamp the radius. */
function towards(from: RoutePoint, to: RoutePoint, radius: number): RoutePoint {
  const length = distance(from, to);
  if (length === 0) return { x: from.x, y: from.y };
  return {
    x: from.x + ((to.x - from.x) / length) * radius,
    y: from.y + ((to.y - from.y) / length) * radius,
  };
}

/* ---------------------------------------------------------------- routing */

interface RouteGrid {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

function buildGrid(
  source: RoutePoint,
  target: RoutePoint,
  obstacles: readonly RouteRect[],
  margin: number,
): RouteGrid {
  const cell = GRID_CELL;
  const minX = Math.min(source.x, target.x) - margin;
  const minY = Math.min(source.y, target.y) - margin;
  const maxX = Math.max(source.x, target.x) + margin;
  const maxY = Math.max(source.y, target.y) + margin;
  const cols = Math.max(2, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(2, Math.ceil((maxY - minY) / cell) + 1);
  const blocked = new Uint8Array(cols * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const square: RouteRect = {
        x: minX + col * cell,
        y: minY + row * cell,
        width: cell,
        height: cell,
      };
      if (obstacles.some((rect) => rectsOverlap(square, rect))) blocked[row * cols + col] = 1;
    }
  }
  return { minX, minY, cell, cols, rows, blocked };
}

interface OpenNode {
  index: number;
  f: number;
  h: number;
}

function search(
  grid: RouteGrid,
  startIndex: number,
  goalIndex: number,
  source: RoutePoint,
  target: RoutePoint,
  budget: number,
): RoutePoint[] | null {
  const total = grid.cols * grid.rows;
  const costs = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open: OpenNode[] = [];
  const goalCol = goalIndex % grid.cols;
  const goalRow = Math.floor(goalIndex / grid.cols);

  costs[startIndex] = 0;
  const first = octile(
    goalCol - (startIndex % grid.cols),
    goalRow - Math.floor(startIndex / grid.cols),
  );
  pushOpen(open, { index: startIndex, f: first, h: first });

  let expanded = 0;
  while (open.length > 0) {
    const current = popOpen(open);
    if (!current || closed[current.index]) continue;
    closed[current.index] = 1;
    expanded += 1;
    if (expanded > budget) return null;
    if (current.index === goalIndex)
      return rebuild(grid, cameFrom, startIndex, goalIndex, source, target);

    const col = current.index % grid.cols;
    const row = Math.floor(current.index / grid.cols);
    const here = costs[current.index] ?? Number.POSITIVE_INFINITY;
    for (const step of NEIGHBOURS) {
      const nextCol = col + step.dc;
      const nextRow = row + step.dr;
      if (!inside(grid, nextCol, nextRow)) continue;
      const nextIndex = nextRow * grid.cols + nextCol;
      if (closed[nextIndex]) continue;
      if (!isFree(grid, nextCol, nextRow, startIndex, goalIndex)) continue;
      // No corner cutting: a diagonal needs both of its orthogonal cells free.
      if (
        step.diagonal &&
        (!isFree(grid, col, nextRow, startIndex, goalIndex) ||
          !isFree(grid, nextCol, row, startIndex, goalIndex))
      ) {
        continue;
      }
      const cost = here + step.cost;
      if (cost >= (costs[nextIndex] ?? Number.POSITIVE_INFINITY)) continue;
      costs[nextIndex] = cost;
      cameFrom[nextIndex] = current.index;
      const h = octile(goalCol - nextCol, goalRow - nextRow);
      pushOpen(open, { index: nextIndex, f: cost + h, h });
    }
  }
  return null;
}

function rebuild(
  grid: RouteGrid,
  cameFrom: Int32Array,
  startIndex: number,
  goalIndex: number,
  source: RoutePoint,
  target: RoutePoint,
): RoutePoint[] {
  const cells: number[] = [goalIndex];
  let index = goalIndex;
  while (index !== startIndex) {
    const previous = cameFrom[index];
    if (previous === undefined || previous < 0) return [];
    cells.push(previous);
    index = previous;
  }
  cells.reverse();

  const points = cells.map((cell) => center(grid, cell));
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [];
  // The anchors are where the link actually attaches, not a cell centre.
  points[0] = { x: source.x, y: source.y };
  points[points.length - 1] = { x: target.x, y: target.y };
  return points;
}

function center(grid: RouteGrid, index: number): RoutePoint {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return {
    x: grid.minX + (col + 0.5) * grid.cell,
    y: grid.minY + (row + 0.5) * grid.cell,
  };
}

function inside(grid: RouteGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
}

/** A blocked cell still counts for the two ends: the anchors sit where the user drew them. */
function isFree(
  grid: RouteGrid,
  col: number,
  row: number,
  startIndex: number,
  goalIndex: number,
): boolean {
  if (!inside(grid, col, row)) return false;
  const index = row * grid.cols + col;
  if (index === startIndex || index === goalIndex) return true;
  return grid.blocked[index] === 0;
}

function cellIndex(grid: RouteGrid, point: RoutePoint): number {
  const col = Math.floor((point.x - grid.minX) / grid.cell);
  const row = Math.floor((point.y - grid.minY) / grid.cell);
  if (!inside(grid, col, row)) return -1;
  return row * grid.cols + col;
}

/** Octile distance: the exact cost of a free diagonal-and-straight walk. */
function octile(dx: number, dy: number): number {
  const forward = Math.abs(dx);
  const sideways = Math.abs(dy);
  return forward + sideways + (Math.SQRT2 - 2) * Math.min(forward, sideways);
}

function better(a: OpenNode, b: OpenNode): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.index < b.index; // stable tie-break keeps two runs identical
}

function pushOpen(heap: OpenNode[], node: OpenNode): void {
  heap.push(node);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    const child = heap[index];
    const above = heap[parent];
    if (!child || !above || !better(child, above)) return;
    heap[index] = above;
    heap[parent] = child;
    index = parent;
  }
}

function popOpen(heap: OpenNode[]): OpenNode | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (!top) return undefined;
  if (heap.length === 0 || !last) return top;
  heap[0] = last;

  let index = 0;
  for (;;) {
    const left = 2 * index + 1;
    const right = left + 1;
    let smallest = index;
    const smallestNode = heap[smallest];
    const leftNode = heap[left];
    if (leftNode && smallestNode && better(leftNode, smallestNode)) smallest = left;
    const currentSmallest = heap[smallest];
    const rightNode = heap[right];
    if (rightNode && currentSmallest && better(rightNode, currentSmallest)) smallest = right;
    if (smallest === index) return top;

    const a = heap[index];
    const b = heap[smallest];
    if (!a || !b) return top;
    heap[index] = b;
    heap[smallest] = a;
    index = smallest;
  }
}

/** Drops the points a route passes through on its way somewhere else. */
function simplify(points: readonly RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    out.push(point);

    while (out.length >= 3) {
      const a = out[out.length - 3];
      const b = out[out.length - 2];
      const c = out[out.length - 1];
      if (!a || !b || !c) break;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const forward = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0;
      if (Math.abs(cross) > EPSILON || !forward) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- rects */

function inflate(rect: RouteRect, by: number): RouteRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

/** Inclusive, because an endpoint anchor sits exactly on its card's edge. */
function containsPoint(rect: RouteRect, point: RoutePoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Touching counts as clear: a line grazing an edge was not routed around it. */
function rectsOverlap(a: RouteRect, b: RouteRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Liang–Barsky: does the segment enter the rect at all, endpoints included? */
function segmentHitsRect(from: RoutePoint, to: RoutePoint, rect: RouteRect): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const p = [-dx, dx, -dy, dy];
  const q = [
    from.x - rect.x,
    rect.x + rect.width - from.x,
    from.y - rect.y,
    rect.y + rect.height - from.y,
  ];
  let enter = 0;
  let leave = 1;

  for (let index = 0; index < p.length; index += 1) {
    const edge = p[index];
    const bound = q[index];
    if (edge === undefined || bound === undefined) continue;
    if (edge === 0) {
      if (bound < 0) return false;
      continue;
    }
    const t = bound / edge;
    if (edge < 0) {
      if (t > leave) return false;
      enter = Math.max(enter, t);
    } else {
      if (t < enter) return false;
      leave = Math.min(leave, t);
    }
  }
  return enter <= leave;
}
