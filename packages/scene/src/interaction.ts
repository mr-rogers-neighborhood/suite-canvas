import type { EdgePath } from "@suite/graph";
import {
  GEOMETRY_EPSILON,
  inverseTransformPoint,
  rectContainsPoint,
  rectFromPoints,
  rectIntersects,
  rectMaxX,
  rectMaxY,
  rectUnionAll,
  screenToPage,
} from "./geometry.js";
import { boardInstanceKey } from "./scene.js";
import type {
  BoardInstance,
  Camera,
  CardInstance,
  EdgeInstance,
  LodBand,
  Point,
  PortalInstance,
  Rect,
  Scene,
  ScenePath,
  SectionInstance,
  Size,
  Transform,
} from "./types.js";

/**
 * Engine-neutral hit testing and gesture math. Everything here is derived from
 * a `Scene`: instances are read-only, cameras are inputs, and no DOM, React or
 * Loro value crosses this boundary. The surface uses page coordinates; the
 * graph receives canonical board coordinates.
 */

/** Screen-space pick slack in CSS pixels. */
export const DEFAULT_HIT_TOLERANCE = 6;

/** Portal chrome band along the top of a frame, as a fraction of its height. */
export const DEFAULT_PORTAL_HEADER_RATIO = 0.18;

/** Curves are flattened this many times for distance work; 24 is ~0.5px accurate. */
export const EDGE_CURVE_SEGMENTS = 24;

const BEZIER_MIN_PULL = 40;
const BEZIER_PULL_RATIO = 0.4;

/* ------------------------------------------------------------------ targets */

export interface SceneHitBase {
  /** Scene instance key; for a pane this is the board instance key. */
  readonly instanceKey: string;
  readonly boardId: string;
  readonly boardKey: string;
  readonly path: ScenePath;
  /** Page-space point that was tested. */
  readonly page: Point;
  /** `page` mapped into the owning board's flow coordinates. */
  readonly board: Point;
}

export interface SceneCardHit extends SceneHitBase {
  readonly kind: "card";
  readonly cardId: string;
  readonly rect: Rect;
  readonly local: Rect;
  readonly z: number;
  readonly lod: LodBand;
}

export interface SceneSectionHit extends SceneHitBase {
  readonly kind: "section";
  readonly sectionId: string;
  readonly rect: Rect;
  readonly local: Rect;
  readonly z: number;
  readonly lod: LodBand;
}

/** Which part of a portal frame the pointer landed on. */
export type ScenePortalPart = "header" | "frame" | "body";

export interface ScenePortalHit extends SceneHitBase {
  readonly kind: "portal";
  readonly cardId: string;
  readonly frame: Rect;
  readonly targetBoardId: string;
  readonly expanded: boolean;
  readonly part: ScenePortalPart;
  readonly lod: LodBand;
}

export interface SceneEdgeHit extends SceneHitBase {
  readonly kind: "edge";
  readonly edgeId: string;
  /** Page-space distance from the pointer to the drawn route. */
  readonly distance: number;
  readonly route: EdgePath;
  readonly bounds: Rect;
  readonly lod: LodBand;
}

/** Empty board space; the fallback so a gesture always has an owner. */
export interface ScenePaneHit extends SceneHitBase {
  readonly kind: "pane";
}

export type SceneHitTarget =
  | SceneCardHit
  | SceneSectionHit
  | ScenePortalHit
  | SceneEdgeHit
  | ScenePaneHit;

export interface HitTestOptions {
  /** Screen-space pick slack in CSS pixels. Defaults to 6. */
  readonly tolerance?: number;
  /** Portal header band as a fraction of the frame height. Defaults to 0.18. */
  readonly portalHeaderRatio?: number;
}

/* --------------------------------------------------------------- references */

export interface SceneInstanceRef {
  readonly instanceKey: string;
  readonly kind: "card" | "section" | "portal" | "edge" | "board";
  readonly boardId: string;
  readonly boardKey: string;
  readonly path: ScenePath;
  readonly cardId: string | null;
  readonly sectionId: string | null;
  readonly edgeId: string | null;
}

export interface SceneRectSelection {
  readonly cards: readonly SceneInstanceRef[];
  readonly sections: readonly SceneInstanceRef[];
  readonly edges: readonly SceneInstanceRef[];
  readonly portals: readonly SceneInstanceRef[];
}

export function rectSelectionKeys(selection: SceneRectSelection): string[] {
  return [...selection.cards, ...selection.sections, ...selection.portals, ...selection.edges].map(
    (entry) => entry.instanceKey,
  );
}

/* ------------------------------------------------------------------- drag */

export interface CanonicalMove {
  readonly boardId: string;
  readonly cardId?: string | undefined;
  readonly sectionId?: string | undefined;
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export type DragKind = "card" | "section" | "portal";

export interface DragItem {
  readonly instanceKey: string;
  readonly kind: DragKind;
  readonly boardId: string;
  readonly boardKey: string;
  readonly path: ScenePath;
  readonly cardId: string | null;
  readonly sectionId: string | null;
  /** Board -> page transform captured when the gesture started. */
  readonly transform: Transform;
  /** Board-space box at drag start; the UI never needs the page rect. */
  readonly startLocal: Rect;
}

export interface DragInput {
  readonly scene: Scene;
  readonly camera: Camera;
  /** Screen-space point where the pointer went down. */
  readonly screenPoint: Point;
  readonly instanceKeys: readonly string[];
}

export interface DragSession {
  readonly startPage: Point;
  readonly startScreen: Point;
  readonly camera: Camera;
  readonly items: readonly DragItem[];
  readonly boardIds: readonly string[];
  readonly cardIds: readonly string[];
  readonly sectionIds: readonly string[];
}

/* ----------------------------------------------------------------- resize */

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

export interface ResizeInput {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly instanceKey: string;
  readonly handle: ResizeHandle;
  /** Screen-space delta since the pointer went down. */
  readonly screenDelta: Point;
  /** Board-space floor for the resulting size. Defaults to 1x1. */
  readonly minSize?: Size | undefined;
}

/* ------------------------------------------------------------------ helpers */

function isFinitePoint(value: Point): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function safePoint(value: Point): Point {
  return isFinitePoint(value) ? value : { x: 0, y: 0 };
}

/** Mirrors `screenToPage`: a non-positive or non-finite zoom counts as 1. */
function cameraZoom(camera: Camera): number {
  return Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
}

function resolveSettings(options: HitTestOptions): { tolerance: number; headerRatio: number } {
  const tolerance =
    options.tolerance !== undefined && Number.isFinite(options.tolerance) && options.tolerance >= 0
      ? options.tolerance
      : DEFAULT_HIT_TOLERANCE;
  const ratio =
    options.portalHeaderRatio !== undefined &&
    Number.isFinite(options.portalHeaderRatio) &&
    options.portalHeaderRatio > 0 &&
    options.portalHeaderRatio <= 1
      ? options.portalHeaderRatio
      : DEFAULT_PORTAL_HEADER_RATIO;
  return { tolerance, headerRatio: ratio };
}

/** Screen-space slack converted into page units for the current zoom. */
function pageTolerance(camera: Camera, options: HitTestOptions): number {
  return resolveSettings(options).tolerance / cameraZoom(camera);
}

function intersectFrames(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const maxX = Math.min(rectMaxX(a), rectMaxX(b));
  const maxY = Math.min(rectMaxY(a), rectMaxY(b));
  if (maxX <= x || maxY <= y) return { x, y, width: 0, height: 0 };
  return { x, y, width: maxX - x, height: maxY - y };
}

/**
 * Page-space clip for every board: its own frame intersected with all ancestor
 * frames, so child content cannot be picked outside the portal that renders it.
 */
function boardClips(scene: Scene): Map<string, Rect> {
  const byKey = new Map(scene.boards.map((board) => [board.key, board] as const));
  const clips = new Map<string, Rect>();
  const resolve = (board: BoardInstance): Rect => {
    const cached = clips.get(board.key);
    if (cached) return cached;
    const parent = board.parentKey === null ? undefined : byKey.get(board.parentKey);
    const clip = parent ? intersectFrames(resolve(parent), board.frame) : board.frame;
    clips.set(board.key, clip);
    return clip;
  };
  for (const board of scene.boards) resolve(board);
  return clips;
}

function clipped(clips: Map<string, Rect>, boardKey: string, point: Point): boolean {
  const clip = clips.get(boardKey);
  return clip ? rectContainsPoint(clip, point, GEOMETRY_EPSILON) : true;
}

interface SceneMaps {
  readonly cards: Map<string, CardInstance>;
  readonly sections: Map<string, SectionInstance>;
  readonly portals: Map<string, PortalInstance>;
  readonly edges: Map<string, EdgeInstance>;
  readonly boards: Map<string, BoardInstance>;
}

function indexScene(scene: Scene): SceneMaps {
  return {
    cards: new Map(scene.cards.map((card) => [card.key, card] as const)),
    sections: new Map(scene.sections.map((section) => [section.key, section] as const)),
    portals: new Map(scene.portals.map((portal) => [portal.key, portal] as const)),
    edges: new Map(scene.edges.map((edge) => [edge.key, edge] as const)),
    boards: new Map(scene.boards.map((board) => [board.key, board] as const)),
  };
}

/* ------------------------------------------------------------------ edges */

function cubicPoint(t: number, a: Point, b: Point, c: Point, d: Point): Point {
  const mt = 1 - t;
  const m0 = mt * mt * mt;
  const m1 = 3 * mt * mt * t;
  const m2 = 3 * mt * t * t;
  const m3 = t * t * t;
  return {
    x: a.x * m0 + b.x * m1 + c.x * m2 + d.x * m3,
    y: a.y * m0 + b.y * m1 + c.y * m2 + d.y * m3,
  };
}

/** The drawn control points for a bezier route; matches the surface renderer. */
export function bezierControls(from: Point, to: Point): { c1: Point; c2: Point } {
  const pull = Math.max(BEZIER_MIN_PULL, Math.abs(to.x - from.x) * BEZIER_PULL_RATIO);
  return {
    c1: { x: from.x + pull, y: from.y },
    c2: { x: to.x - pull, y: to.y },
  };
}

/**
 * Flatten an edge route into a polyline in the edge's own (page) space. Step
 * routes use the same midpoint elbow as the renderer; smoothstep shares that
 * elbow, so the rounded corners only change the distance by sub-pixel amounts.
 */
export function edgeRoutePolyline(
  from: Point,
  to: Point,
  route: EdgePath,
  segments = EDGE_CURVE_SEGMENTS,
): readonly Point[] {
  if (!isFinitePoint(from) || !isFinitePoint(to)) return [];
  if (route === "straight") return [from, to];
  if (route === "step" || route === "smoothstep") {
    const middle = (from.x + to.x) / 2;
    return [from, { x: middle, y: from.y }, { x: middle, y: to.y }, to];
  }
  const { c1, c2 } = bezierControls(from, to);
  const count = Math.max(1, Math.floor(segments));
  const points: Point[] = [];
  for (let index = 0; index <= count; index += 1) {
    points.push(cubicPoint(index / count, from, c1, c2, to));
  }
  return points;
}

function distanceToSegment(target: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < GEOMETRY_EPSILON) return Math.hypot(target.x - a.x, target.y - a.y);
  const projection = ((target.x - a.x) * dx + (target.y - a.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  return Math.hypot(target.x - (a.x + t * dx), target.y - (a.y + t * dy));
}

function distanceToPolyline(points: readonly Point[], target: Point): number {
  const first = points[0];
  if (!first) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return Math.hypot(target.x - first.x, target.y - first.y);
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!a || !b) continue;
    closest = Math.min(closest, distanceToSegment(target, a, b));
  }
  return closest;
}

/** Page-space distance from `pagePoint` to the edge's actual drawn route. */
export function distanceToEdge(edge: EdgeInstance, pagePoint: Point): number {
  if (!isFinitePoint(pagePoint)) return Number.POSITIVE_INFINITY;
  return distanceToPolyline(edgeRoutePolyline(edge.from, edge.to, edge.route), pagePoint);
}

/** Page-space bounds of the drawn route, always at least one unit wide/tall. */
export function edgeRouteBounds(from: Point, to: Point, route: EdgePath): Rect {
  if (!isFinitePoint(from) || !isFinitePoint(to)) return { x: 0, y: 0, width: 1, height: 1 };
  const points = edgeRoutePolyline(from, to, route);
  const bounds = rectUnionAll(
    points.map((value) => ({ x: value.x, y: value.y, width: 0, height: 0 })),
  ) ?? {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

/* --------------------------------------------------------------- hit test */

const KIND_RANK = { section: 0, edge: 1, card: 2 } as const;

interface Candidate {
  readonly target: SceneHitTarget;
  readonly depth: number;
  readonly rank: number;
  readonly order: number;
}

/** Deeper boards paint above their parents; cards paint above edges and sections. */
function outranks(candidate: Candidate, incumbent: Candidate): boolean {
  if (candidate.depth !== incumbent.depth) return candidate.depth > incumbent.depth;
  if (candidate.rank !== incumbent.rank) return candidate.rank > incumbent.rank;
  return candidate.order > incumbent.order;
}

function cardTarget(card: CardInstance, page: Point): SceneCardHit {
  return {
    kind: "card",
    instanceKey: card.key,
    cardId: card.cardId,
    boardId: card.boardId,
    boardKey: card.boardKey,
    path: card.path,
    page,
    board: inverseTransformPoint(card.transform, page) ?? page,
    rect: card.rect,
    local: card.local,
    z: card.z,
    lod: card.lod,
  };
}

function sectionTarget(section: SectionInstance, page: Point): SceneSectionHit {
  return {
    kind: "section",
    instanceKey: section.key,
    sectionId: section.sectionId,
    boardId: section.boardId,
    boardKey: section.boardKey,
    path: section.path,
    page,
    board: inverseTransformPoint(section.transform, page) ?? page,
    rect: section.rect,
    local: section.local,
    z: section.z,
    lod: section.lod,
  };
}

function edgeTarget(edge: EdgeInstance, page: Point, distance: number): SceneEdgeHit {
  return {
    kind: "edge",
    instanceKey: edge.key,
    edgeId: edge.edgeId,
    boardId: edge.boardId,
    boardKey: edge.boardKey,
    path: edge.path,
    page,
    board: inverseTransformPoint(edge.transform, page) ?? page,
    distance,
    route: edge.route,
    bounds: edge.bounds,
    lod: edge.lod,
  };
}

function portalTarget(portal: PortalInstance, page: Point, part: ScenePortalPart): ScenePortalHit {
  return {
    kind: "portal",
    instanceKey: portal.key,
    cardId: portal.cardId,
    boardId: portal.boardId,
    boardKey: boardInstanceKey(portal.path),
    path: portal.path,
    page,
    board: inverseTransformPoint(portal.transform, page) ?? page,
    frame: portal.frame,
    targetBoardId: portal.targetBoardId,
    expanded: portal.expanded,
    part,
    lod: portal.lod,
  };
}

function onFrameRing(frame: Rect, point: Point, tolerance: number): boolean {
  const inner: Rect = {
    x: frame.x + tolerance,
    y: frame.y + tolerance,
    width: Math.max(0, frame.width - tolerance * 2),
    height: Math.max(0, frame.height - tolerance * 2),
  };
  if (inner.width <= 0 || inner.height <= 0) return true;
  return !rectContainsPoint(inner, point, 0);
}

/**
 * Portal chrome wins over the live board it contains, but only on the header
 * band and the frame ring; the rest of an expanded frame belongs to the child
 * board. Shallow portals are tested first so outer chrome stays on top.
 */
function hitPortal(
  scene: Scene,
  point: Point,
  tolerance: number,
  headerRatio: number,
  clips: Map<string, Rect>,
): ScenePortalHit | null {
  const portals = [...scene.portals].sort((a, b) => a.path.length - b.path.length);
  for (const portal of portals) {
    if (portal.lod === "hidden") continue;
    if (!clipped(clips, boardInstanceKey(portal.path), point)) continue;
    const frame = portal.frame;
    if (!rectContainsPoint(frame, point, tolerance)) continue;
    if (!portal.expanded) return portalTarget(portal, point, "body");
    const headerHeight = frame.height * headerRatio;
    const inHeaderBand =
      point.x >= frame.x - tolerance &&
      point.x <= rectMaxX(frame) + tolerance &&
      point.y >= frame.y - tolerance &&
      point.y <= frame.y + headerHeight + tolerance;
    if (inHeaderBand) return portalTarget(portal, point, "header");
    if (onFrameRing(frame, point, tolerance)) return portalTarget(portal, point, "frame");
  }
  return null;
}

function hitInstance(
  scene: Scene,
  point: Point,
  tolerance: number,
  clips: Map<string, Rect>,
): SceneHitTarget | null {
  const candidates: Candidate[] = [];
  const consider = (target: SceneHitTarget, depth: number, rank: number) => {
    candidates.push({ target, depth, rank, order: candidates.length });
  };

  for (const section of scene.sections) {
    if (section.lod === "hidden") continue;
    if (!clipped(clips, section.boardKey, point)) continue;
    if (!rectContainsPoint(section.rect, point, tolerance)) continue;
    consider(sectionTarget(section, point), section.path.length, KIND_RANK.section);
  }

  for (const edge of scene.edges) {
    if (edge.lod === "hidden") continue;
    if (!clipped(clips, edge.boardKey, point)) continue;
    const distance = distanceToEdge(edge, point);
    if (distance > tolerance) continue;
    consider(edgeTarget(edge, point, distance), edge.path.length, KIND_RANK.edge);
  }

  for (const card of scene.cards) {
    // Portal cards resolve through `hitPortal` so their chrome rules apply.
    if (card.portalKey !== null) continue;
    if (card.lod === "hidden") continue;
    if (!clipped(clips, card.boardKey, point)) continue;
    if (!rectContainsPoint(card.rect, point, tolerance)) continue;
    consider(cardTarget(card, point), card.path.length, KIND_RANK.card);
  }

  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (!best || outranks(candidate, best)) best = candidate;
  }
  return best === null ? null : best.target;
}

function paneTarget(scene: Scene, point: Point, clips: Map<string, Rect>): ScenePaneHit {
  let chosen: BoardInstance | null = null;
  for (const board of scene.boards) {
    if (!clipped(clips, board.key, point)) continue;
    if (!chosen || board.path.length >= chosen.path.length) chosen = board;
  }
  const board = chosen ?? scene.root;
  return {
    kind: "pane",
    instanceKey: board.key,
    boardId: board.boardId,
    boardKey: board.key,
    path: board.path,
    page: point,
    board: inverseTransformPoint(board.transform, point) ?? point,
  };
}

/**
 * Topmost visible instance under a screen point. Expanded portal chrome takes
 * the header band and frame ring; live child content owns the rest of the area.
 * Always returns a target: empty board space becomes a `pane` hit.
 *
 * Visibility comes from the instance LOD baked into the scene, so `camera`
 * should be the one the scene was built with; it is accepted separately so
 * pointer math and scene projection cannot drift.
 */
export function hitTest(
  scene: Scene,
  camera: Camera,
  screenPoint: Point,
  options: HitTestOptions = {},
): SceneHitTarget {
  const settings = resolveSettings(options);
  const page = safePoint(screenToPage(camera, screenPoint));
  const zoom = cameraZoom(camera);
  const tolerance = settings.tolerance / zoom;
  const clips = boardClips(scene);
  const portal = hitPortal(scene, page, tolerance, settings.headerRatio, clips);
  if (portal) return portal;
  const instance = hitInstance(scene, page, tolerance, clips);
  if (instance) return instance;
  return paneTarget(scene, page, clips);
}

/** Closest visible edge within the screen-space tolerance, or null. */
export function hitTestEdge(
  scene: Scene,
  camera: Camera,
  screenPoint: Point,
  options: HitTestOptions = {},
): SceneEdgeHit | null {
  const page = safePoint(screenToPage(camera, screenPoint));
  const tolerance = pageTolerance(camera, options);
  const clips = boardClips(scene);
  let best: SceneEdgeHit | null = null;
  for (const edge of scene.edges) {
    if (edge.lod === "hidden") continue;
    if (!clipped(clips, edge.boardKey, page)) continue;
    const distance = distanceToEdge(edge, page);
    if (distance > tolerance) continue;
    const candidate = edgeTarget(edge, page, distance);
    if (
      !best ||
      candidate.distance < best.distance ||
      (candidate.distance === best.distance && edge.path.length > best.path.length)
    ) {
      best = candidate;
    }
  }
  return best;
}

/* ----------------------------------------------------------- marquee select */

/** Rect spanned by two page points; non-finite input stays non-finite on purpose. */
export function marqueeRect(start: Point, end: Point): Rect {
  return rectFromPoints(start, end);
}

/** Screen rect -> page rect; null when either corner is not finite. */
function screenRectToPage(camera: Camera, screenRect: Rect): Rect | null {
  if (
    !Number.isFinite(screenRect.x) ||
    !Number.isFinite(screenRect.y) ||
    !Number.isFinite(screenRect.width) ||
    !Number.isFinite(screenRect.height)
  ) {
    return null;
  }
  const a = screenToPage(camera, { x: screenRect.x, y: screenRect.y });
  const b = screenToPage(camera, {
    x: screenRect.x + screenRect.width,
    y: screenRect.y + screenRect.height,
  });
  if (!isFinitePoint(a) || !isFinitePoint(b)) return null;
  return rectFromPoints(a, b);
}

function cardRef(card: CardInstance): SceneInstanceRef {
  return {
    instanceKey: card.key,
    kind: "card",
    boardId: card.boardId,
    boardKey: card.boardKey,
    path: card.path,
    cardId: card.cardId,
    sectionId: null,
    edgeId: null,
  };
}

/**
 * Instances touched by a marquee. Portal cards appear under `portals` only, so
 * a marquee never yields two keys for the same canonical card. Nested board
 * content is included, exactly like the surfaces that render it; callers that
 * want top-level only can filter by `path.length`.
 */
export function hitTestRect(scene: Scene, camera: Camera, screenRect: Rect): SceneRectSelection {
  const pageRect = screenRectToPage(camera, screenRect);
  if (!pageRect) return { cards: [], sections: [], edges: [], portals: [] };

  const cards: SceneInstanceRef[] = [];
  for (const card of scene.cards) {
    if (card.portalKey !== null || card.lod === "hidden") continue;
    if (!rectIntersects(card.rect, pageRect)) continue;
    cards.push(cardRef(card));
  }

  const sections: SceneInstanceRef[] = [];
  for (const section of scene.sections) {
    if (section.lod === "hidden") continue;
    if (!rectIntersects(section.rect, pageRect)) continue;
    sections.push({
      instanceKey: section.key,
      kind: "section",
      boardId: section.boardId,
      boardKey: section.boardKey,
      path: section.path,
      cardId: null,
      sectionId: section.sectionId,
      edgeId: null,
    });
  }

  const edges: SceneInstanceRef[] = [];
  for (const edge of scene.edges) {
    if (edge.lod === "hidden") continue;
    if (!rectIntersects(edgeRouteBounds(edge.from, edge.to, edge.route), pageRect)) continue;
    edges.push({
      instanceKey: edge.key,
      kind: "edge",
      boardId: edge.boardId,
      boardKey: edge.boardKey,
      path: edge.path,
      cardId: null,
      sectionId: null,
      edgeId: edge.edgeId,
    });
  }

  const portals: SceneInstanceRef[] = [];
  for (const portal of scene.portals) {
    if (portal.lod === "hidden") continue;
    if (!rectIntersects(portal.frame, pageRect)) continue;
    portals.push({
      instanceKey: portal.key,
      kind: "portal",
      boardId: portal.boardId,
      boardKey: boardInstanceKey(portal.path),
      path: portal.path,
      cardId: portal.cardId,
      sectionId: null,
      edgeId: null,
    });
  }

  return { cards, sections, edges, portals };
}

/* ---------------------------------------------------------- selection math */

function instanceBounds(maps: SceneMaps, key: string): Rect | null {
  const card = maps.cards.get(key);
  if (card) return card.rect;
  const section = maps.sections.get(key);
  if (section) return section.rect;
  const portal = maps.portals.get(key);
  if (portal) return portal.frame;
  const edge = maps.edges.get(key);
  if (edge) return edgeRouteBounds(edge.from, edge.to, edge.route);
  const board = maps.boards.get(key);
  if (board) return board.frame;
  return null;
}

/** Union of the page-space boxes of every resolvable instance; null when none. */
export function selectionBounds(scene: Scene, instanceKeys: readonly string[]): Rect | null {
  if (instanceKeys.length === 0) return null;
  const maps = indexScene(scene);
  const rects: Rect[] = [];
  for (const key of instanceKeys) {
    const bounds = instanceBounds(maps, key);
    if (bounds) rects.push(bounds);
  }
  return rectUnionAll(rects);
}

/* ------------------------------------------------------------------- drag */

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Capture everything a drag needs before the pointer moves: the start page
 * point, and each instance's canonical board plus the transform that maps that
 * board into page space. Keys that are not movable (edges, boards) are ignored.
 */
export function beginDrag(input: DragInput): DragSession {
  const maps = indexScene(input.scene);
  const seen = new Set<string>();
  const items: DragItem[] = [];

  for (const key of input.instanceKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const card = maps.cards.get(key);
    if (card) {
      items.push({
        instanceKey: card.key,
        kind: "card",
        boardId: card.boardId,
        boardKey: card.boardKey,
        path: card.path,
        cardId: card.cardId,
        sectionId: null,
        transform: card.transform,
        startLocal: card.local,
      });
      continue;
    }
    const section = maps.sections.get(key);
    if (section) {
      items.push({
        instanceKey: section.key,
        kind: "section",
        boardId: section.boardId,
        boardKey: section.boardKey,
        path: section.path,
        cardId: null,
        sectionId: section.sectionId,
        transform: section.transform,
        startLocal: section.local,
      });
      continue;
    }
    const portal = maps.portals.get(key);
    if (portal) {
      items.push({
        instanceKey: portal.key,
        kind: "portal",
        boardId: portal.boardId,
        boardKey: boardInstanceKey(portal.path),
        path: portal.path,
        cardId: portal.cardId,
        sectionId: null,
        transform: portal.transform,
        startLocal: portal.localFrame,
      });
    }
  }

  const startPage = screenToPage(input.camera, input.screenPoint);
  return {
    startPage: safePoint(startPage),
    startScreen: input.screenPoint,
    camera: input.camera,
    items,
    boardIds: unique(items.map((item) => item.boardId)),
    cardIds: unique(
      items
        .map((item) => item.cardId)
        .filter((value): value is string => typeof value === "string"),
    ),
    sectionIds: unique(
      items
        .map((item) => item.sectionId)
        .filter((value): value is string => typeof value === "string"),
    ),
  };
}

/**
 * Canonical moves for the current pointer position. The page delta is divided
 * by each instance's board scale, which is what makes a drag inside a scaled
 * portal land on the same relative spot in the child board.
 */
export function dragDelta(session: DragSession, currentPage: Point): CanonicalMove[] {
  if (!isFinitePoint(currentPage) || !isFinitePoint(session.startPage)) return [];
  const pageDx = currentPage.x - session.startPage.x;
  const pageDy = currentPage.y - session.startPage.y;
  const moves: CanonicalMove[] = [];
  const seen = new Set<string>();

  for (const item of session.items) {
    const scale = item.transform.scale;
    if (!Number.isFinite(scale) || Math.abs(scale) < GEOMETRY_EPSILON) continue;
    const canonical = item.cardId ?? item.sectionId;
    if (canonical === null) continue;
    const dedupeKey = `${item.cardId === null ? "s" : "c"}:${canonical}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const x = item.startLocal.x + pageDx / scale;
    const y = item.startLocal.y + pageDy / scale;
    moves.push({
      boardId: item.boardId,
      ...(item.cardId === null ? {} : { cardId: item.cardId }),
      ...(item.sectionId === null ? {} : { sectionId: item.sectionId }),
      x,
      y,
    });
  }

  return moves;
}

/* ----------------------------------------------------------------- resize */

interface ResizeTarget {
  readonly start: Rect;
  readonly transform: Transform;
  readonly boardId: string;
  readonly cardId: string | null;
  readonly sectionId: string | null;
}

function resizeTarget(maps: SceneMaps, key: string): ResizeTarget | null {
  const card = maps.cards.get(key);
  if (card) {
    return {
      start: card.local,
      transform: card.transform,
      boardId: card.boardId,
      cardId: card.cardId,
      sectionId: null,
    };
  }
  const section = maps.sections.get(key);
  if (section) {
    return {
      start: section.local,
      transform: section.transform,
      boardId: section.boardId,
      cardId: null,
      sectionId: section.sectionId,
    };
  }
  const portal = maps.portals.get(key);
  if (portal) {
    return {
      start: portal.localFrame,
      transform: portal.transform,
      boardId: portal.boardId,
      cardId: portal.cardId,
      sectionId: null,
    };
  }
  return null;
}

function emptyRect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

function resizeHandleActive(handle: ResizeHandle, side: "n" | "s" | "e" | "w"): boolean {
  return handle.includes(side);
}

/**
 * New board-space rect for a card or section after a screen-space drag of one
 * handle. Both the camera zoom and the owning board scale are divided out, so
 * the same gesture works inside a nested, scaled portal.
 */
export function resizeFromHandle(input: ResizeInput): Rect {
  const target = resizeTarget(indexScene(input.scene), input.instanceKey);
  if (!target) return emptyRect();
  return resizeRect(target.start, target.transform, input);
}

/**
 * Same math as `resizeFromHandle`, shaped as a canonical write for the graph so
 * a resize can be applied without re-deriving the board id or instance id.
 */
export function resizeMove(input: ResizeInput): CanonicalMove | null {
  const target = resizeTarget(indexScene(input.scene), input.instanceKey);
  if (!target) return null;
  const rect = resizeRect(target.start, target.transform, input);
  return {
    boardId: target.boardId,
    ...(target.cardId === null ? {} : { cardId: target.cardId }),
    ...(target.sectionId === null ? {} : { sectionId: target.sectionId }),
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function resizeRect(start: Rect, transform: Transform, input: ResizeInput): Rect {
  const zoom = cameraZoom(input.camera);
  const scale = transform.scale;
  const dx = input.screenDelta.x;
  const dy = input.screenDelta.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return start;
  if (!Number.isFinite(scale) || Math.abs(scale) < GEOMETRY_EPSILON) return start;
  if (!RESIZE_HANDLES.includes(input.handle)) return start;

  const localDx = dx / zoom / scale;
  const localDy = dy / zoom / scale;
  const minWidth =
    input.minSize?.width !== undefined && input.minSize.width > 0 ? input.minSize.width : 1;
  const minHeight =
    input.minSize?.height !== undefined && input.minSize.height > 0 ? input.minSize.height : 1;

  let { x, y, width, height } = start;

  if (resizeHandleActive(input.handle, "e")) width = start.width + localDx;
  if (resizeHandleActive(input.handle, "s")) height = start.height + localDy;
  if (resizeHandleActive(input.handle, "w")) {
    width = start.width - localDx;
    x = start.x + localDx;
  }
  if (resizeHandleActive(input.handle, "n")) {
    height = start.height - localDy;
    y = start.y + localDy;
  }

  if (width < minWidth) {
    if (resizeHandleActive(input.handle, "w")) x = start.x + start.width - minWidth;
    width = minWidth;
  }
  if (height < minHeight) {
    if (resizeHandleActive(input.handle, "n")) y = start.y + start.height - minHeight;
    height = minHeight;
  }

  return { x, y, width, height };
}
