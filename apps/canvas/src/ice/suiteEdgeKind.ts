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
 * - **Props are stable**: `edgeId`, `kind`, `path`, `thickness`, `arrow`. Nothing
 *   that changes per frame lives in props.
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
 *
 * Nothing here writes a document: the props are display-only, and the endpoint
 * truth is `graphEdgeSchema` in `@suite/graph`.
 */

import { type EdgeKind, type EdgePath, edgeKinds, edgePaths } from "@suite/graph";
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
 * The opacity a link's ink is laid at, by the relation it draws: a link is
 * quieter than the cards it joins, and a reference (a derived index) is the
 * quietest of the three. The colour is the palette's ink (`pens.card`), never a
 * literal — a link is a stroke on the desk, not a surface.
 */
/** The ink a link falls back to when the palette names none (the shell's `--ink`). */
const DEFAULT_EDGE_INK: readonly [number, number, number] = [0.11, 0.11, 0.12];

export const SUITE_EDGE_TONE: Readonly<Record<EdgeKind, number>> = {
  references: 0.55,
  "relates-to": 0.9,
  tagged: 0.7,
};

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
  const box = polylineBounds(polyline, thickness / 2);
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
}

/** A link's two ends. */
export interface SuiteEdgeLink {
  readonly source: SuiteEdgeEnd;
  readonly target: SuiteEdgeEnd;
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
      box: polylineBounds(polyline, thickness / 2),
      // A screen-space slop, taken back into world units: six CSS px of miss is
      // six world units at zoom 1 and sixty at zoom 0.1.
      hitSlop: Math.max(thickness / 2, SUITE_EDGE_HIT_PX / zoom),
    };
  },
  // One sheet per quad: a link is ink on the desk, so the sheet *is* the stroke
  // and its fibre, curl and shadow are all zeroed.
  record(geometry, ctx) {
    const look = ctx.look as PaperLook | undefined;
    const ink = look?.pens.card ?? Object.values(look?.pens ?? {})[0] ?? DEFAULT_EDGE_INK;
    const tone = SUITE_EDGE_TONE[propEdgeKind(ctx.props)] ?? SUITE_EDGE_TONE.references;
    return geometry.quads.map((quad) => ({
      geometry: sheetGeometry(quad, tone),
      paper: ink,
      ink,
      grain: 0,
      inkDensity: 0,
    }));
  },
  hit(geometry, wx, wy): ObjectHit | null {
    return suiteEdgeHitTest(geometry, wx, wy) ? "content" : null;
  },
  // The marks go around the link's own bounds, not around a sheet's.
  frame(geometry) {
    const { x, y, width, height } = geometry.box;
    return {
      cx: x + width / 2,
      cy: y + height / 2,
      hx: width / 2,
      hy: height / 2,
      angle: 0,
      r: 0,
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
  },
  groups: { edge: ["edgeId", "kind", "path", "thickness", "arrow"] },
  size: SUITE_EDGE_SIZE,
  kind: suiteEdgeKind,
  interaction: SUITE_EDGE_INTERACTION,
  provides: [DESK_OBJECT],
  drivers: (host) => {
    const local = host.local as SuiteEdgeLocal | undefined;
    if (local === undefined) return undefined;
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

/** An endpoint's world anchor this frame, or undefined when it has left the desk. */
function anchorOf(world: World, end: SuiteEdgeEnd): Point | undefined {
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
    const from = anchorOf(world, link.source);
    const to = anchorOf(world, link.target);
    if (from === undefined || to === undefined) {
      // An end has left the desk (a card on a plane this slot does not draw):
      // the link is dormant and draws nothing until both ends resolve again.
      local.dropTrace(entity);
      continue;
    }

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
        box: polylineBounds(polyline, thickness / 2),
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
