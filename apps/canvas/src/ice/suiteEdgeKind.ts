/**
 * `suite.edge` — a link drawn by the desk, under the camera (ADR-0035, ADR-0039).
 *
 * A link is a polyline between two cards' world anchors. The pure maths is
 * `iceEdgeGeometry.ts` (`anchorWorld`, `routeEdge`, …); this file is the GPU
 * half and the wiring the surface drives.
 *
 * ## Program — the reused paper program, one rotated quad per segment
 *
 * The decided trade-off: **one rotated quad per segment**, never a ribbon
 * strip. A strip needs custom WGSL plus a vertex buffer per edge; a quad per
 * segment is expressible with the kind's own geometry — `resolve()` turns the
 * polyline into a list of oriented capsules and `record()` hands each one to the
 * paper program as a flat sheet — so no shader is written here and the edge is
 * drawn by the same pass, in the same order, as the cards it joins.
 *
 * The cost of that choice is faceting at HARD corners: a `step` polyline turns
 * 90° at a corner and two quads meet there with a visible seam (each quad is a
 * stadium whose round cap reaches one thickness past its endpoint, which closes
 * the notch but leaves the direction change). `bezier` and `smoothstep` are 24
 * samples whose turns are a few degrees each, so they never show a facet. If a
 * future link needs genuinely smooth hairpins, that is the moment to write the
 * strip shader — not before.
 *
 * The program name is ours (`suite.edge`), so the ground compiles a paper pass
 * for this kind beside the note's, exactly as `suite.card` and `suite.board` do.
 * `SuiteEdgePass` wraps that pass and flattens one edge's list of sheets into
 * the paper pass's paint order, mapping `drawRange`'s object indices onto the
 * flattened ones so the ground's runs stay contiguous.
 *
 * ## What is drawn from where
 *
 * - **Props are stable**: `edgeId`, `kind`, `path`, `thickness`, `arrow`, `label`.
 *   Nothing that changes per frame lives in props. The label is the document's
 *   text projected onto the object; the surface keeps it true (`useIceLinkGesture`
 *   writes it through `setWidgetProps`) and draws it as a screen-space chip,
 *   because a description has to be readable at every zoom and the desk's only
 *   text path is the paper ink raster, which a link is not (see
 *   `suiteEdgeLabelLayer.ts`).
 * - **The polyline is a per-driver side table** keyed by entity, refreshed in
 *   `drivers.follow()`. The driver reads each endpoint's live `Position`/`Size`
 *   from the world (so a drag moves the link with no write) plus that card's
 *   Board frame offsets — which only the surface knows — through
 *   `setSuiteEdgeLinkOf`.
 * - **The object's own `Position`/`Size` are the polyline's bounding box**, also
 *   kept up to date by `follow()`. ICE culls and picks by that rect first.
 * - **The stratum is `sheets`**, so a link lies over the Board it crosses and
 *   under every card.
 * - **`hit()` is a distance test to the polyline**, never the bounding rect:
 *   a 2-unit line has to stay grabbable. The slop is `SUITE_EDGE_HIT_PX` screen
 *   pixels taken back through the resolve frame's zoom, so it grows as the
 *   camera pulls away.
 * - **`frame()` is a piece of the line, not the box**: the desk's marks draw
 *   around the silhouette a kind reports, so a link reports its longest segment
 *   turned to match it. A selection that brackets the whole bounding box would
 *   read as a card's frame; one that hugs a run of ink reads as a line.
 *
 * Nothing here writes a document: the props are display-only, and the endpoint
 * truth is `graphEdgeSchema` in `@suite/graph`.
 */

import { boardSideAnchor, type EdgeKind, type EdgePath, edgeKinds, edgePaths } from "@suite/graph";
import {
  type Component,
  defineQuery,
  type Entity,
  Position,
  PrefabId,
  p,
  Size,
  type World,
} from "@vibecook/ice";
import {
  CONTAINABLE,
  DESK_OBJECT,
  defineObject,
  type KindDriver,
  type KindDriverHost,
  type KindLocal,
  type KindPass,
  type KindProgram,
  type MatPass,
  numberProp,
  type ObjectHit,
  type ObjectKind,
  stringProp,
} from "@vibecook/ice/desk";
import { type PaperLook, paperKind } from "@vibecook/ice/desk/objects";
import {
  anchorWorld,
  type EdgeConnector,
  type EdgeEndInput,
  type Point,
  type Rect,
  routeEdge,
} from "./iceEdgeGeometry";

const paper = paperKind();

/** The paper program's record and geometry (the objects package does not re-export them by name). */
type PaperKindOf = ReturnType<typeof paperKind>;
type PaperRecord = ReturnType<PaperKindOf["record"]>;
type PaperRecordGeometry = Parameters<PaperKindOf["record"]>[0];

/** Our kind's per-desk state: the polyline side table and the last anchors seen. */
type SuiteEdgeLocal = KindLocal & {
  traceOf(e: Entity): SuiteEdgeTrace | undefined;
  setTrace(e: Entity, trace: SuiteEdgeTrace): void;
  polylineOf(e: Entity): readonly Point[] | undefined;
  /** Ask the desk to remake this link's record — a re-route is not always a box change. */
  touch(e: Entity): void;
  /** Forget this link's polyline: it has no two ends on the desk this frame. */
  dropTrace(e: Entity): void;
  clear(): void;
};

/** What the driver remembers about one edge between frames — the recompute test reads it. */
export interface SuiteEdgeTrace {
  readonly polyline: readonly Point[];
  /** The world anchors the polyline was routed between; a move of either is what remakes it. */
  readonly from: Point;
  readonly to: Point;
  readonly path: EdgePath;
  /** The box written to `Position`/`Size` for this trace. */
  readonly box: Rect;
}

/** The object type and its kind share the name; both are unique on this desk. */
export const SUITE_EDGE_TYPE = "suite.edge";
export const SUITE_EDGE_KIND = "suite.edge";

/** The footprint a link takes before its first `follow()` — the box replaces it immediately. */
export const SUITE_EDGE_SIZE = { w: 1, h: 1 } as const;

/** Links ride with the Boards (`sheets`), over the mat and under every card. */
export const SUITE_EDGE_STRATUM = "sheets" as const;

/** World units of ink: two, the width a link reads at zoom 1. */
export const SUITE_EDGE_DEFAULT_THICKNESS = 2;

/** Screen pixels of slop a press may miss a link's ink by (the inverse zoom puts it back in world units). */
export const SUITE_EDGE_HIT_PX = 6;

/** Arrowhead length as a multiple of the link's thickness. */
export const SUITE_EDGE_ARROW_LENGTH = 4;

/** Half the angle between an arrowhead's two barbs, radians. */
export const SUITE_EDGE_ARROW_SPREAD = Math.PI / 6;

const EPSILON = 1e-6;
const BOX_EPSILON = 1e-3;
const ZOOM_MIN = 0.01;
const ZOOM_MAX = 100;

/**
 * How much of the ink a link keeps, by the relation it draws: a link is quieter
 * than the cards it joins, and a reference (a derived index) is the quietest of
 * the three. The rest is the sheet's colour, so the tone is mixed into the ink
 * rather than laid over it — a stroke is a run of overlapping segments, and an
 * alpha would darken every joint. The colour is the palette's ink (`pens.card`),
 * never a literal: a link is a stroke on the desk, not a surface.
 */
/** The ink a link falls back to when the palette names none (the shell's `--ink`). */
const DEFAULT_EDGE_INK: readonly [number, number, number] = [0.11, 0.11, 0.12];

export const SUITE_EDGE_TONE: Readonly<Record<EdgeKind, number>> = {
  references: 0.55,
  "relates-to": 0.9,
  tagged: 0.7,
};

/**
 * The halo a link's ink lies on: a stroke of the *sheet* colour, wider than the
 * ink on both sides, so the same line reads on paper and on a dark Board — the
 * desk's own keyline trick (`MARKS.inks.keyline`) applied to object ink instead
 * of chrome. Without it a link crossing a Board's face is ink on ink, and the
 * one thing a link must do is stay visible while it is being read.
 */
export const SUITE_EDGE_HALO = {
  /** World units the halo reaches past the ink's edge, each side. */
  grow: 1.5,
} as const;

/** The halo's ink when the palette names no sheet (the shell's `--surface`). */
const DEFAULT_EDGE_HALO_INK: readonly [number, number, number] = [0.99, 0.99, 0.98];

/**
 * Selectable, never moved or resized — an edge's endpoints are its authority,
 * so a drag on the line means nothing until dragging an *end* re-routes it.
 * `snap: "none"` keeps the guides off it and `drop: "never"` keeps it out of
 * every container.
 */
export const SUITE_EDGE_INTERACTION = {
  selectable: true,
  movable: false,
  resizable: false,
  snap: "none",
  drop: "never",
} as const;

/** What the kind carries about a link (its `edge` group, read as `SuiteEdgeFace`). */
export type SuiteEdgeFace = {
  readonly edgeId: string;
  readonly kind: EdgeKind;
  readonly path: EdgePath;
  readonly thickness: number;
  readonly arrow: boolean;
  /** The document's description, as the surface last projected it; `""` for none. */
  readonly label: string;
};

/** What the projection hands `suiteEdgeSpawn`. */
export interface SuiteEdgeSpawnInput {
  readonly edgeId: string;
  readonly kind: EdgeKind;
  readonly path: EdgePath;
  /** The source anchor in the frame the link is drawn in (the Boards' lowest common ancestor). */
  readonly from: Point;
  /** The target anchor, in that same frame. */
  readonly to: Point;
  readonly thickness?: number;
  readonly arrow?: boolean;
  /** The description to draw; the surface re-projects it when the document changes. */
  readonly label?: string;
}

/** What `spawnWidget` takes for one link, with our type filled in. */
export interface SuiteEdgeSpawn {
  readonly type: typeof SUITE_EDGE_TYPE;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly props: SuiteEdgeFace;
}

/**
 * One link's spawn. The box is the polyline's own bounds, grown by half its
 * thickness so the ink is never clipped by the cull margin: the driver replaces
 * it with the exact box on the first `follow()`, and this one is what the very
 * first frame is culled by.
 *
 * `from`/`to` are already in the frame the link is drawn in — the surface
 * resolves both anchors into `edgeFrameOf`'s lowest common ancestor — so a
 * same-Board link and one that crosses a frame are the same call here.
 */
export function suiteEdgeSpawn(input: SuiteEdgeSpawnInput): SuiteEdgeSpawn {
  const thickness = saneThickness(input.thickness ?? SUITE_EDGE_DEFAULT_THICKNESS);
  const polyline = routeEdge({ from: input.from, to: input.to, path: input.path });
  const box = polylineBounds(polyline, edgeInkReach(thickness));
  return {
    type: SUITE_EDGE_TYPE,
    x: box.x,
    y: box.y,
    w: box.width,
    h: box.height,
    props: {
      edgeId: input.edgeId,
      kind: input.kind,
      path: input.path,
      thickness,
      arrow: input.arrow === true,
      label: input.label ?? "",
    },
  };
}

/** One segment as the quadrilateral that draws it: a capsule in world units, centred and turned. */
export interface EdgeQuad {
  readonly cx: number;
  readonly cy: number;
  /** The quad's full length along its own x — the segment grown by one thickness, so neighbours overlap at a joint. */
  readonly length: number;
  /** The ink's width across its own y. */
  readonly thickness: number;
  /** Radians, clockwise on screen (y down). */
  readonly angle: number;
  readonly cos: number;
  readonly sin: number;
}

/**
 * The quads a polyline draws as. Each segment is one capsule whose round caps
 * reach `thickness / 2` past both of its ends, so two segments that meet at an
 * angle overlap by a cap instead of leaving a notch. Zero-length segments are
 * skipped, so a repeated sample costs no quad.
 */
export function segmentQuads(polyline: readonly Point[], thickness: number): EdgeQuad[] {
  const width = saneThickness(thickness);
  const quads: EdgeQuad[] = [];
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const from = polyline[index];
    const to = polyline[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) continue;
    const cos = dx / length;
    const sin = dy / length;
    quads.push({
      cx: (from.x + to.x) / 2,
      cy: (from.y + to.y) / 2,
      length: length + width,
      thickness: width,
      angle: Math.atan2(dy, dx),
      cos,
      sin,
    });
  }
  return quads;
}

/**
 * The two barbs of an arrowhead at the polyline's target end: each a capsule
 * leaving the tip backwards, `SUITE_EDGE_ARROW_LENGTH × thickness` long and one
 * thickness wide, spread `±SUITE_EDGE_ARROW_SPREAD` off the incoming direction.
 * Empty for a degenerate polyline (no direction to point along).
 */
export function arrowQuads(polyline: readonly Point[], thickness: number): EdgeQuad[] {
  const tip = polyline[polyline.length - 1];
  if (tip === undefined || polyline.length < 2) return [];

  let before: Point | undefined;
  for (let index = polyline.length - 2; index >= 0; index -= 1) {
    const candidate = polyline[index];
    if (candidate === undefined) continue;
    if (Math.hypot(tip.x - candidate.x, tip.y - candidate.y) > EPSILON) {
      before = candidate;
      break;
    }
  }
  if (before === undefined) return [];

  const width = saneThickness(thickness);
  const barb = width * SUITE_EDGE_ARROW_LENGTH;
  // Back along the line: an arrowhead opens away from where the edge came from.
  const back = Math.atan2(tip.y - before.y, tip.x - before.x) + Math.PI;
  return [-SUITE_EDGE_ARROW_SPREAD, SUITE_EDGE_ARROW_SPREAD].map((spread) => {
    const angle = back + spread;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      cx: tip.x + (cos * barb) / 2,
      cy: tip.y + (sin * barb) / 2,
      length: barb,
      thickness: width,
      angle,
      cos,
      sin,
    };
  });
}

/** The axis-aligned box of a polyline, grown by `pad` on every side. */
export function polylineBounds(polyline: readonly Point[], pad = 0): Rect {
  const first = polyline[0];
  if (first === undefined) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of polyline) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/** How far `(x, y)` lies from the nearest point of the polyline, world units. Infinite for an empty polyline. */
export function distanceToPolyline(polyline: readonly Point[], x: number, y: number): number {
  const first = polyline[0];
  if (first === undefined) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return Math.hypot(x - first.x, y - first.y);

  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const from = polyline[index];
    const to = polyline[index + 1];
    if (from === undefined || to === undefined) continue;
    best = Math.min(best, distanceToSegment(from, to, x, y));
  }
  return best;
}

/** A run of the polyline: two neighbouring samples, the ones the marks bracket. */
export interface PolylineSegment {
  readonly from: Point;
  readonly to: Point;
}

/**
 * The polyline's longest single segment. A route is a run of samples — 24 of
 * them for a curve, three legs for a `step` — so the longest one is a piece of
 * ink the length of a leg at least, and the marks drawn around it are a line's
 * marks. Null for a route with nothing to bracket.
 */
export function longestSegment(polyline: readonly Point[]): PolylineSegment | null {
  let best: PolylineSegment | null = null;
  let bestLength = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const from = polyline[index];
    const to = polyline[index + 1];
    if (from === undefined || to === undefined) continue;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!(length > bestLength)) continue;
    best = { from, to };
    bestLength = length;
  }
  return best;
}

/** The point half way along the ink, measured along the route rather than across its box. */
export function polylineMidpoint(polyline: readonly Point[]): Point | null {
  const first = polyline[0];
  if (first === undefined) return null;
  let total = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const from = polyline[index];
    const to = polyline[index + 1];
    if (from === undefined || to === undefined) continue;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  if (!(total > 0)) return { x: first.x, y: first.y };
  let walked = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const from = polyline[index];
    const to = polyline[index + 1];
    if (from === undefined || to === undefined) continue;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (walked + length >= total / 2) {
      const t = length === 0 ? 0 : (total / 2 - walked) / length;
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    }
    walked += length;
  }
  return {
    x: polyline[polyline.length - 1]?.x ?? first.x,
    y: polyline[polyline.length - 1]?.y ?? first.y,
  };
}

/** The geometry a link resolves to this frame: what the pass draws and what the pick tests against. */
export interface SuiteEdgeGeometry {
  readonly polyline: readonly Point[];
  /** One capsule per segment, then the arrowhead's barbs when the link carries one. */
  readonly quads: readonly EdgeQuad[];
  readonly thickness: number;
  /** The frame's camera zoom — what `hit` takes its screen-space slop back through. */
  readonly zoom: number;
  readonly arrow: boolean;
  /** The box the object's `Position`/`Size` should hold (the polyline's bounds, grown by the ink). */
  readonly box: Rect;
  /** World units a press may miss the ink by: `SUITE_EDGE_HIT_PX` at this zoom, never under the ink itself. */
  readonly hitSlop: number;
}

/**
 * Is the world point on the link? A distance test to the polyline with the
 * inverse-zoom slop — never the bounding rect, so a 2-unit line is still
 * grabbable and the empty air inside a bent link is not.
 */
export function suiteEdgeHitTest(geometry: SuiteEdgeGeometry, wx: number, wy: number): boolean {
  return distanceToPolyline(geometry.polyline, wx, wy) <= geometry.hitSlop;
}

/** One edge's anchors, as the surface knows them. */
export interface SuiteEdgeEnd {
  /**
   * The ICE object standing for this endpoint card. Its live `Position`/`Size`
   * are read every frame, so a drag in flight moves the link with no write.
   */
  readonly entity?: Entity | undefined;
  /**
   * Where the card lies when it has no object on this desk (another plane, a
   * culled Board): the placement in its own Board's frame, as
   * `iceEdgeGeometry.anchorWorld` takes it.
   */
  readonly placement?: EdgeEndInput["placement"] | undefined;
  /** Ancestor Board rects, root first, ending with the card's own Board. */
  readonly frames: readonly Rect[];
  readonly connectors?: readonly EdgeConnector[] | undefined;
  readonly connectorId?: string | undefined;
  /**
   * A Board end (ADR-0041): the frame this end names. The surface resolves it to
   * `frame` on every call, so a frame a peer moved carries its link with it.
   */
  readonly boardId?: string | undefined;
  /** That frame's rect in world units, filled in by the resolver. */
  readonly frame?: Rect | undefined;
}

/** A link's two ends. */
export interface SuiteEdgeLink {
  readonly source: SuiteEdgeEnd;
  readonly target: SuiteEdgeEnd;
  /**
   * The frame the link is drawn in, as that frame's origin in world units: the
   * object is a child of the frame's mat, so the polyline it holds is
   * frame-local. Absent on the root plane, where world *is* local.
   */
  readonly origin?: Point | undefined;
}

/**
 * How the surface answers "where are this edge's ends?". Registered once with
 * `setSuiteEdgeLinkOf`; the driver calls it every frame, which is why it must
 * read the live document (positions, connector choice, the Board chain) and not
 * a snapshot.
 */
export type SuiteEdgeLinkOf = (edgeId: string) => SuiteEdgeLink | undefined;

let linkOf: SuiteEdgeLinkOf | undefined;

/**
 * Register the endpoint resolver. The surface owns `WorkspaceDocument`, so it is
 * the only place that can say where an edge's ends are in the world; the kind
 * never reads `@suite/graph` itself.
 */
export function setSuiteEdgeLinkOf(next: SuiteEdgeLinkOf | undefined): void {
  linkOf = next;
}

/**
 * The kind's per-desk state, keyed by the world it belongs to. Two desks number
 * their entities alike, so a bare entity key would let one surface's link answer
 * for another's; the world is the scope everything here is true in.
 */
const localsOf = new WeakMap<World, SuiteEdgeLocal>();

/**
 * Where a link's description sits: the middle of its ink, off the polyline's own
 * box, in the same units `entityRectOf` reports the object in. The surface's
 * label layer adds this to the object's box origin and projects it with the
 * camera, which is the one place that knows where the world is on screen.
 *
 * An empty label still has a point — the editor opens there — so this answers
 * for every drawn link, not only the described ones.
 */
export function suiteEdgeLabelOffset(world: World, entity: Entity): Point | undefined {
  const trace = localsOf.get(world)?.traceOf(entity);
  if (trace === undefined) return undefined;
  const middle = polylineMidpoint(trace.polyline);
  if (middle === null) return undefined;
  return { x: middle.x - trace.box.x, y: middle.y - trace.box.y };
}

/** Every widget carries `PrefabId`; the walk below filters it by our type id. */
const WIDGETS = defineQuery([PrefabId]);

/** Every `suite.edge` object on this world (the driver's walk). */
export function suiteEdgeEntities(world: World): Entity[] {
  return world.entities(WIDGETS).filter((entity) => {
    if (!world.isAlive(entity)) return false;
    return world.read(entity, PrefabId)?.id === SUITE_EDGE_TYPE;
  });
}

/** The ink is never nothing: a non-finite or sub-pixel width falls back to a width that can be seen. */
function saneThickness(thickness: number): number {
  if (!Number.isFinite(thickness)) return SUITE_EDGE_DEFAULT_THICKNESS;
  return Math.max(Math.abs(thickness), 0.25);
}

function saneZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
}

function distanceToSegment(from: Point, to: Point, x: number, y: number): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(x - from.x, y - from.y);
  const t = Math.min(Math.max(((x - from.x) * dx + (y - from.y) * dy) / lengthSquared, 0), 1);
  return Math.hypot(x - (from.x + t * dx), y - (from.y + t * dy));
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) <= BOX_EPSILON && Math.abs(left.y - right.y) <= BOX_EPSILON;
}

/** A capsule as the paper program's sheet: flat, no curl, no shadow, no fibre. */
function sheetGeometry(quad: EdgeQuad, alpha: number): PaperRecordGeometry {
  const halfThickness = quad.thickness / 2;
  return {
    centre: [quad.cx, quad.cy] as const,
    half: [quad.length / 2, halfThickness] as const,
    cos: quad.cos,
    sin: quad.sin,
    angle: quad.angle,
    lift: 0,
    curl: 0,
    cornerCurl: 0,
    glue: 0,
    relief: 0,
    radius: halfThickness,
    shadow: { sigma: 0, alpha: 0, sigmaPerUnit: 0 },
    slope: [0, 0] as const,
    lamp: [0, 0, 1] as const,
    ring: 0,
    alpha,
    scale: 1,
  };
}

/** How far a link's drawing reaches past its polyline: the ink's half width plus the halo. */
function edgeInkReach(thickness: number): number {
  return thickness / 2 + SUITE_EDGE_HALO.grow;
}

/** `tone` of the ink over the sheet: what a link's stroke is, mixed rather than alpha-laid. */
function mixedInk(
  ink: readonly [number, number, number],
  sheet: readonly [number, number, number],
  tone: number,
): readonly [number, number, number] {
  const keep = Math.min(Math.max(tone, 0), 1);
  return [
    sheet[0] + (ink[0] - sheet[0]) * keep,
    sheet[1] + (ink[1] - sheet[1]) * keep,
    sheet[2] + (ink[2] - sheet[2]) * keep,
  ];
}

/** The same capsule, wider by `grow` on every side — the halo a quad's ink lies on. */
function widerQuad(quad: EdgeQuad, grow: number): EdgeQuad {
  return { ...quad, thickness: quad.thickness + grow * 2 };
}

/** Our records are one *list* of sheets per object; the paper pass's are one sheet per record. */
type SuiteEdgePassRecords = KindPass<readonly PaperRecord[]>;

/**
 * The paper pass, one level up: `prepare` flattens each object's sheets in paint
 * order and remembers where its run starts, so `drawRange` — which speaks object
 * indices — can hand the paper pass the matching sheets.
 */
class SuiteEdgePass implements SuiteEdgePassRecords {
  private readonly inner: KindPass<PaperRecord>;
  /** `first[i]` is object `i`'s first flattened sheet; the last entry is the total. */
  private first: number[] = [0];

  constructor(inner: KindPass<PaperRecord>) {
    this.inner = inner;
  }

  spawn(mat: MatPass): SuiteEdgePass {
    return new SuiteEdgePass(this.inner.spawn(mat));
  }

  tune(root: SuiteEdgePassRecords): void {
    if (root instanceof SuiteEdgePass) this.inner.tune?.(root.inner);
  }

  prepare(...args: Parameters<SuiteEdgePassRecords["prepare"]>): number {
    const [encoder, slot, records, extra] = args;
    const first: number[] = [0];
    const sheets: PaperRecord[] = [];
    for (const record of records) {
      for (const sheet of record) sheets.push(sheet);
      first.push(sheets.length);
    }
    this.first = first;
    // The paper store's keys are per record; an edge's sheets have no stable
    // identity of their own (a re-route rewrites all of them), so the pass packs
    // them afresh instead of mapping our keys through the expansion.
    return this.inner.prepare(
      encoder,
      slot,
      sheets,
      extra === undefined ? undefined : { live: extra.live },
    );
  }

  drawRange(...args: Parameters<SuiteEdgePassRecords["drawRange"]>): void {
    const [pass, first, end] = args;
    const total = this.first[this.first.length - 1] ?? 0;
    const from = this.first[first] ?? total;
    const to = this.first[end] ?? total;
    this.inner.drawRange(pass, from, to);
  }

  dropped(): number {
    return this.inner.dropped?.() ?? 0;
  }

  dispose(): void {
    this.inner.dispose?.();
  }
}

const suiteEdgeKind: ObjectKind<SuiteEdgeGeometry, readonly PaperRecord[]> = {
  // The ground compiles one pass per kind name, so the paper's program runs
  // beside the note's — the same trick `suite.card` and `suite.board` play. Only
  // the five fields a link actually wants come across: the program, the shelf
  // it lies on, its cull margin, its palette and its rung. The paper's own
  // `record`/`hit`/`frame`/`face`/`chip`/`card` are all about a *sheet*, and
  // every one of them is replaced or dropped below.
  name: SUITE_EDGE_KIND,
  // NOT the paper's `things`: a link belongs to the plane it is drawn on. In
  // `sheets` it lies over the Board it crosses (a line leaving one frame and
  // entering another has to be visible on the frame's own mat) and under every
  // card, so a link never paints across a card's face.
  stratum: SUITE_EDGE_STRATUM,
  reach: paper.reach,
  ...(paper.theme === undefined ? {} : { theme: paper.theme }),
  ...(paper.rung === undefined ? {} : { rung: paper.rung }),
  create(...args: Parameters<KindProgram<PaperRecord>["create"]>) {
    return paper.create(...args).then((inner) => new SuiteEdgePass(inner));
  },
  // The side table is ours, so the paper writing's `local` (its ink pages, its
  // caret, its rung) is not built at all: a link carries no text.
  local: (host) => createSuiteEdgeLocal(undefined, host.remake),
  resolve(ctx) {
    const local = ctx.local as SuiteEdgeLocal | undefined;
    const polyline = local?.polylineOf(ctx.entity) ?? [];
    const thickness = saneThickness(
      numberProp(ctx.props, "thickness", SUITE_EDGE_DEFAULT_THICKNESS),
    );
    const arrow = ctx.props.arrow === true;
    const quads = arrow
      ? [...segmentQuads(polyline, thickness), ...arrowQuads(polyline, thickness)]
      : segmentQuads(polyline, thickness);
    const zoom = saneZoom(ctx.view.zoom);
    return {
      polyline,
      quads,
      thickness,
      zoom,
      arrow,
      box: polylineBounds(polyline, edgeInkReach(thickness)),
      // A screen-space slop, taken back into world units: six CSS px of miss is
      // six world units at zoom 1 and sixty at zoom 0.1.
      hitSlop: Math.max(thickness / 2, SUITE_EDGE_HIT_PX / zoom),
    };
  },
  // One halo per quad, then the ink: a link is a stroke on the desk, so the
  // sheet *is* the stroke and its fibre, curl and shadow are all zeroed. The
  // halo takes the palette's sheet colour — the same value a card is painted
  // with — so it holds against whatever ground the link crosses.
  record(geometry, ctx) {
    const look = ctx.look as PaperLook | undefined;
    const ink = look?.pens.card ?? Object.values(look?.pens ?? {})[0] ?? DEFAULT_EDGE_INK;
    const sheet =
      look?.papers?.card ?? Object.values(look?.papers ?? {})[0] ?? DEFAULT_EDGE_HALO_INK;
    const tone = SUITE_EDGE_TONE[propEdgeKind(ctx.props)] ?? SUITE_EDGE_TONE.references;
    const stroke = mixedInk(ink, sheet, tone);
    // Every halo first, then every stroke: a segment's halo overlaps its
    // neighbour's cap, so interleaving them would lighten the ink at each joint.
    // Both are laid whole (`alpha` 1) for the same reason — the segments overlap
    // by design, and a joint a peer can see as a darker knot is not a stroke.
    const sheets: PaperRecord[] = geometry.quads.map((quad) => ({
      geometry: sheetGeometry(widerQuad(quad, SUITE_EDGE_HALO.grow), 1),
      paper: sheet,
      ink: sheet,
      grain: 0,
      inkDensity: 0,
    }));
    for (const quad of geometry.quads) {
      sheets.push({
        geometry: sheetGeometry(quad, 1),
        paper: stroke,
        ink: stroke,
        grain: 0,
        inkDensity: 0,
      });
    }
    return sheets;
  },
  hit(geometry, wx, wy): ObjectHit | null {
    return suiteEdgeHitTest(geometry, wx, wy) ? "content" : null;
  },
  // The marks go around a piece of the link, never its bounding box: a bracket
  // at the corners of a bent link's box is a card's frame, which is exactly what
  // a selected line must not look like. The longest segment, turned to its own
  // direction and no taller than the ink, is a run of the stroke.
  frame(geometry) {
    const segment = longestSegment(geometry.polyline);
    if (segment === null) {
      const { x, y, width, height } = geometry.box;
      return {
        cx: x + width / 2,
        cy: y + height / 2,
        hx: width / 2,
        hy: height / 2,
        angle: 0,
        r: 0,
      };
    }
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const half = saneThickness(geometry.thickness) / 2;
    return {
      cx: (segment.from.x + segment.to.x) / 2,
      cy: (segment.from.y + segment.to.y) / 2,
      hx: Math.hypot(dx, dy) / 2,
      hy: half,
      angle: Math.atan2(dy, dx),
      r: half,
    };
  },
  // A link never lives inside a container (`drop: "never"`), so it has no chip.
  chip: () => null,
};

function propEdgeKind(props: Readonly<Record<string, unknown>>): EdgeKind {
  const kind = stringProp(props, "kind", "references");
  return kind === "relates-to" || kind === "tagged" ? kind : "references";
}

export const SuiteEdge = defineObject({
  type: SUITE_EDGE_TYPE,
  version: 1,
  props: {
    // The workspace link this object draws; the surface uses it to find the ends.
    edgeId: p.string({ default: "" }),
    // The relation the link draws — the tone it is laid at.
    kind: p.enum(edgeKinds, { default: "references" }),
    // How the line is routed between the two anchors.
    path: p.enum(edgePaths, { default: "bezier" }),
    // The ink's width in world units, as `edgeRender(delta, zoom)` gave it.
    thickness: p.number({ default: SUITE_EDGE_DEFAULT_THICKNESS }),
    // An arrowhead at the target end.
    arrow: p.boolean({ default: false }),
    // The document's description of the relation. Empty means "no description";
    // the surface keeps it in step with `edge.label` (one `setWidgetProps` per
    // change, never per frame).
    label: p.string({ default: "" }),
  },
  groups: { edge: ["edgeId", "kind", "path", "thickness", "arrow", "label"] },
  size: SUITE_EDGE_SIZE,
  kind: suiteEdgeKind,
  interaction: SUITE_EDGE_INTERACTION,
  // `CONTAINABLE` is what lets a link be spawned *inside* its frame's mat: a
  // container only accepts what provides it. `drop: "never"` still means no
  // gesture may put a link into a Board.
  provides: [DESK_OBJECT, CONTAINABLE],
  drivers: (host) => {
    const local = host.local as SuiteEdgeLocal | undefined;
    if (local === undefined) return undefined;
    // A kind host always has a world; a unit test's stub may not, and a weak
    // map refuses anything that is not an object.
    const world: unknown = host.world;
    if (typeof world === "object" && world !== null) localsOf.set(world as World, local);
    const driver: KindDriver = {
      // Always follow: an endpoint can move with no input on this object at all
      // (another client's drag arrives as a Position write), so the idle budget
      // is not ours to spend. No `idle` means "never skipped".
      follow: () => followSuiteEdges(host, local),
      dispose: () => local.clear(),
    };
    return driver;
  },
});

/** The `edge` group's component — the props the pick and the follow read without a registry. */
export const SUITE_EDGE_FACE = groupOf("edge");

function groupOf(name: string): Component<SuiteEdgeFace> {
  const group = SuiteEdge.groups.find((candidate) => candidate.name === name);
  if (group === undefined) throw new Error(`suite.edge: no "${name}" group`);
  return group.component as unknown as Component<SuiteEdgeFace>;
}

function createSuiteEdgeLocal(
  base: KindLocal | undefined,
  remake: ((e: Entity) => void) | undefined,
): SuiteEdgeLocal {
  const traces = new Map<Entity, SuiteEdgeTrace>();
  return {
    ...base,
    traceOf: (entity) => traces.get(entity),
    setTrace: (entity, trace) => {
      traces.set(entity, trace);
    },
    polylineOf: (entity) => traces.get(entity)?.polyline,
    touch: (entity) => remake?.(entity),
    dropTrace: (entity) => {
      traces.delete(entity);
    },
    clear: () => {
      traces.clear();
    },
    forget: (entity) => {
      traces.delete(entity);
      base?.forget?.(entity);
    },
  };
}

/**
 * An endpoint's world anchor this frame, or undefined when it has left the desk.
 *
 * A card end answers from its own placement and connectors, so it does not care
 * what it is linked to. A Board end has no single anchor: it leaves by the wall
 * facing `toward`, which is why the caller hands in the other end's centre.
 */
function anchorOf(world: World, end: SuiteEdgeEnd, toward?: Point): Point | undefined {
  if (end.frame !== undefined) {
    const centre = {
      x: end.frame.x + end.frame.width / 2,
      y: end.frame.y + end.frame.height / 2,
    };
    return toward === undefined ? centre : boardSideAnchor(end.frame, toward);
  }
  const placement = end.entity === undefined ? end.placement : livePlacement(world, end.entity);
  if (placement === undefined) return undefined;
  return anchorWorld({
    placement,
    frames: end.frames,
    ...(end.connectors === undefined ? {} : { connectors: end.connectors }),
    ...(end.connectorId === undefined ? {} : { connectorId: end.connectorId }),
  });
}

/** The endpoint's placement as the world holds it now — the live half of "where is this card". */
function livePlacement(world: World, entity: Entity): EdgeEndInput["placement"] | undefined {
  if (!world.isAlive(entity)) return undefined;
  const position = world.get(entity, Position);
  if (position === undefined) return undefined;
  const size = world.get(entity, Size);
  return {
    x: position.x,
    y: position.y,
    ...(size === undefined ? {} : { width: size.w, height: size.h }),
  };
}

/**
 * One frame of link geometry.
 *
 * Recompute policy: a polyline is re-routed only when an anchor actually moved.
 * The trace keeps the two world anchors it was routed between (after
 * `anchorWorld`: the Board offsets are already folded in), and a link whose ends
 * are within `BOX_EPSILON` of where they were last frame — and whose `path` did
 * not change — keeps its polyline untouched. That is the common case by far: a
 * still camera over a still desk routes nothing, and dragging one card re-routes
 * only the links hanging off it.
 */
function followSuiteEdges(host: KindDriverHost, local: SuiteEdgeLocal): void {
  const resolve = linkOf;
  const world = host.world;

  for (const entity of suiteEdgeEntities(world)) {
    const face = world.get(entity, SUITE_EDGE_FACE);
    if (face === undefined) continue;

    const link = resolve?.(face.edgeId);
    if (link === undefined) {
      local.dropTrace(entity);
      continue;
    }
    // Each end first answers where its own middle is: a Board end needs the
    // other end's direction to know which wall it leaves by, and a card end
    // ignores the hint entirely, so the two orders cannot disagree.
    const sourceCentre = anchorOf(world, link.source);
    const targetCentre = anchorOf(world, link.target);
    const worldFrom =
      sourceCentre === undefined
        ? undefined
        : anchorOf(world, link.source, targetCentre ?? sourceCentre);
    const worldTo =
      targetCentre === undefined
        ? undefined
        : anchorOf(world, link.target, sourceCentre ?? targetCentre);
    if (worldFrom === undefined || worldTo === undefined) {
      // An end has left the desk (a card on a plane this slot does not draw):
      // the link is dormant and draws nothing until both ends resolve again.
      local.dropTrace(entity);
      continue;
    }
    // The anchors are world; the object sits inside its frame, so the polyline
    // is the anchor less the frame's origin.
    const origin = link.origin ?? { x: 0, y: 0 };
    const from = { x: worldFrom.x - origin.x, y: worldFrom.y - origin.y };
    const to = { x: worldTo.x - origin.x, y: worldTo.y - origin.y };

    const last = local.traceOf(entity);
    const moved =
      last === undefined ||
      last.path !== face.path ||
      !samePoint(last.from, from) ||
      !samePoint(last.to, to);
    if (moved) {
      const polyline = routeEdge({ from, to, path: face.path });
      const thickness = saneThickness(face.thickness);
      local.setTrace(entity, {
        polyline,
        from,
        to,
        path: face.path,
        box: polylineBounds(polyline, edgeInkReach(thickness)),
      });
      // The box may come out identical (a card moving between two corners of
      // the same bounds), so the record is remade by hand as well: the builder's
      // own invalidation reads facts, and the polyline is not one.
      local.touch(entity);
    }

    const trace = local.traceOf(entity);
    if (trace === undefined) continue;
    writeBox(world, entity, trace.box);
  }
}

/** Keep the object's own rect on the polyline's bounds — ICE culls and picks by it first. */
function writeBox(world: World, entity: Entity, box: Rect): void {
  const position = world.get(entity, Position);
  const size = world.get(entity, Size);
  const moved =
    position === undefined ||
    size === undefined ||
    Math.abs(position.x - box.x) > BOX_EPSILON ||
    Math.abs(position.y - box.y) > BOX_EPSILON;
  const sized =
    size === undefined ||
    Math.abs(size.w - box.width) > BOX_EPSILON ||
    Math.abs(size.h - box.height) > BOX_EPSILON;
  if (moved) world.edit(entity).set(Position, { x: box.x, y: box.y });
  if (sized) world.edit(entity).set(Size, { w: box.width, h: box.height });
}
