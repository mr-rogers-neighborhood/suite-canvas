/**
 * The graph band's camera and reconciliation maths (ADR-0037).
 *
 * Three questions live here, all pure so the surface can be checked without a
 * desk:
 *
 * 1. **Where is the ceiling?** The zoom at which the whole View fits. Below it
 *    the canvas has nothing left to show at card scale, so the membrane is what
 *    the camera pushes against.
 * 2. **Where is the graph view?** The ceiling's content framed a little wider,
 *    and never *inside* the lid: committing continues the motion outward rather
 *    than snapping back in.
 * 3. **What changed in the projection?** The graph is rebuilt from the document
 *    on band entry and on every revision, so the spawn plan is a diff against
 *    what the surface already holds, keyed by `TypeGraphNode.key`.
 *
 * Cameras here are the surface's own (`cameraOf()`): `{x, y, zoom}` with
 * `world = (screen - x) / zoom`. ICE's `Camera` stores the world coordinate of
 * the screen's top-left instead, so the projection writes `-x / zoom`; keeping
 * the conversion in one place is the point of this module.
 *
 * No DOM, no engine, no clock, no document.
 */

import { GRAPH_BAND, type TypeGraphNode } from "@suite/scene";
import type { FlightCamera, FlightViewport } from "./iceCameraFlight";

/** A world rect: the shape bounds arrive in from `@suite/scene`. */
export interface BandRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A rect the caller has to size itself (a card with no stored extent). */
export interface BandExtent {
  readonly width: number;
  readonly height: number;
}

/** Screen margin kept around the framed content, as a fraction of the viewport. */
export const GRAPH_FIT_PADDING = 0.06;

/** A fit is never tighter than this, so an enormous empty View still frames. */
export const GRAPH_MIN_ZOOM = 0.02;

/** …and never closer than this, so a single small node does not fill the screen. */
export const GRAPH_MAX_ZOOM = 4;

/** The graph view sits at this share of the ceiling: past the lid, always. */
export const GRAPH_PAST_LID = 0.9;

/**
 * The least zoom that leaves the graph band, with margin over the exit
 * threshold so a return never lands on the hysteresis edge.
 */
export const GRAPH_RETURN_ZOOM = GRAPH_BAND.exit * 1.25;

/** Framing one type's instances is a reading move, so it stops here. */
export const GRAPH_FRAME_MAX_ZOOM = 2;

const DEFAULT_EXTENT: BandExtent = { width: 288, height: 240 };

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function usableZoom(zoom: number | undefined): zoom is number {
  return finite(zoom) && zoom > 0;
}

/** The union of world rects, or null when there is nothing to frame. */
export function unionRect(rects: readonly BandRect[]): BandRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const rect of rects) {
    if (!finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height)) {
      continue;
    }
    seen = true;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!seen) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** A placement's world rect; an unset extent takes the card's natural size. */
export function placementRect(
  placement: {
    readonly x: number;
    readonly y: number;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
  },
  natural: BandExtent = DEFAULT_EXTENT,
): BandRect {
  return {
    x: placement.x,
    y: placement.y,
    width: usableZoom(placement.width) ? placement.width : natural.width,
    height: usableZoom(placement.height) ? placement.height : natural.height,
  };
}

/**
 * The union of one type's placements on the View — what "frame this type"
 * flies to. Ids are the caller's (it knows the type registry); an empty set
 * frames nothing, so the camera stays put.
 */
export function typeUnionBounds(
  placements: readonly {
    readonly cardId: string;
    readonly x: number;
    readonly y: number;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
  }[],
  cardIds: ReadonlySet<string>,
  natural: BandExtent = DEFAULT_EXTENT,
): BandRect | null {
  if (cardIds.size === 0) return null;
  return unionRect(
    placements.filter((p) => cardIds.has(p.cardId)).map((p) => placementRect(p, natural)),
  );
}

/** The zoom at which `bounds` fits the viewport with the standard margin. */
export function fitZoom(
  bounds: BandRect | null,
  viewport: FlightViewport | null,
  padding: number = GRAPH_FIT_PADDING,
): number {
  if (bounds === null || viewport === null) return GRAPH_BAND.exit;
  const pad = finite(padding) ? clamp(padding, 0, 0.4) : GRAPH_FIT_PADDING;
  const width = viewport.width * (1 - pad * 2);
  const height = viewport.height * (1 - pad * 2);
  if (!usableZoom(width) || !usableZoom(height)) return GRAPH_BAND.exit;
  const zoom = Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height));
  return clamp(zoom, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
}

/** A camera that centres `bounds` at `zoom` (fit when the zoom is omitted). */
export function cameraForBounds(
  bounds: BandRect | null,
  viewport: FlightViewport | null,
  zoom: number = fitZoom(bounds, viewport),
): FlightCamera {
  if (bounds === null || viewport === null) return { x: 0, y: 0, zoom };
  const centreX = bounds.x + bounds.width / 2;
  const centreY = bounds.y + bounds.height / 2;
  return {
    x: viewport.width / 2 - centreX * zoom,
    y: viewport.height / 2 - centreY * zoom,
    zoom,
  };
}

/**
 * The ceiling: the zoom at which the Whole View fits. With no content there is
 * nothing to fit, so the graph band's own entry threshold stands in — pushing
 * there still commits, which is what an empty View should do.
 */
export function ceilingZoomFor(bounds: BandRect | null, viewport: FlightViewport | null): number {
  return bounds === null ? GRAPH_BAND.exit : fitZoom(bounds, viewport);
}

/**
 * The graph view's zoom: the graph bounds fitted, but always a step past the
 * lid, because the graph is entered by continuing outward, never by snapping
 * back in.
 */
export function graphZoomFor(
  bounds: BandRect | null,
  viewport: FlightViewport | null,
  ceilingZoom: number,
): number {
  const lid = usableZoom(ceilingZoom) ? ceilingZoom : GRAPH_BAND.exit;
  const fit = fitZoom(bounds, viewport);
  return clamp(Math.min(fit, lid * GRAPH_PAST_LID), GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
}

/** The camera a commit flies to. */
export function graphCameraFor(
  bounds: BandRect | null,
  viewport: FlightViewport | null,
  ceilingZoom: number,
): FlightCamera {
  return cameraForBounds(bounds, viewport, graphZoomFor(bounds, viewport, ceilingZoom));
}

/**
 * The zoom a return lands on: the ceiling when the ceiling is already above the
 * band, otherwise the least zoom that leaves it. A View that fits below 0.12 is
 * *always* the graph at the ceiling, so returning to that camera would not
 * return at all.
 */
export function returnZoom(ceilingZoom: number): number {
  const lid = usableZoom(ceilingZoom) ? ceilingZoom : GRAPH_BAND.exit;
  return lid > GRAPH_BAND.exit ? lid : GRAPH_RETURN_ZOOM;
}

/** The camera a release, Escape or the breadcrumb flies back to. */
export function returnCameraFor(
  bounds: BandRect | null,
  viewport: FlightViewport | null,
  ceilingZoom: number,
): FlightCamera {
  return cameraForBounds(bounds, viewport, returnZoom(ceilingZoom));
}

/**
 * Framing one type is a reading move (the user named a destination), so it may
 * come closer than the band — but not so close that a one-card type fills the
 * screen.
 */
export function frameCameraFor(
  bounds: BandRect | null,
  viewport: FlightViewport | null,
): FlightCamera {
  const zoom = clamp(fitZoom(bounds, viewport), GRAPH_RETURN_ZOOM, GRAPH_FRAME_MAX_ZOOM);
  return cameraForBounds(bounds, viewport, zoom);
}

/**
 * `camera` with its zoom replaced, holding the world point under `anchor`
 * (screen px) still — what a zoom-in/zoom-out control asks for.
 */
export function zoomedCamera(
  camera: FlightCamera,
  zoom: number,
  anchor: { readonly x: number; readonly y: number },
): FlightCamera {
  const next = clamp(usableZoom(zoom) ? zoom : camera.zoom, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
  if (!usableZoom(camera.zoom) || !finite(camera.x) || !finite(camera.y)) {
    return { ...camera, zoom: next };
  }
  const worldX = (anchor.x - camera.x) / camera.zoom;
  const worldY = (anchor.y - camera.y) / camera.zoom;
  return { x: anchor.x - worldX * next, y: anchor.y - worldY * next, zoom: next };
}

/**
 * The camera after applying `share` of the engine's own zoom step, holding the
 * world point under `anchor` (screen px) still. The engine has already moved;
 * this damps that movement instead of replacing it, so the surface never owns
 * a second zoom model.
 */
export function dampedZoom(
  from: FlightCamera,
  to: FlightCamera,
  share: number,
  anchor: { readonly x: number; readonly y: number },
): FlightCamera {
  if (!usableZoom(from.zoom) || !usableZoom(to.zoom) || !finite(from.x) || !finite(from.y)) {
    return to;
  }
  const amount = finite(share) ? clamp(share, 0, 1) : 1;
  if (amount >= 1) return to;
  const ratio = to.zoom / from.zoom;
  if (!usableZoom(ratio)) return to;
  const zoom = from.zoom * ratio ** amount;
  // world = (screen - x) / zoom, and it must not move under the pointer.
  const worldX = (anchor.x - from.x) / from.zoom;
  const worldY = (anchor.y - from.y) / from.zoom;
  return { x: anchor.x - worldX * zoom, y: anchor.y - worldY * zoom, zoom };
}

/**
 * Everything about a node that changes what is drawn. Geometry is the whole
 * reason a graph entity is re-spawned rather than moved: ICE 0.16.0 has no
 * supported `setPosition`, so a derivation change is a replace.
 */
export function graphNodeSignature(node: TypeGraphNode): string {
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return [
    node.kind,
    round(node.x),
    round(node.y),
    round(node.width),
    round(node.height),
    node.label,
    node.glyph,
    node.count,
    node.depth,
    node.color ?? "",
  ].join("\u001f");
}

export interface GraphReconcilePlan {
  /** Keys to despawn first: gone from the projection, or drawn differently. */
  readonly remove: readonly string[];
  /** Nodes to spawn after the removals. */
  readonly spawn: readonly TypeGraphNode[];
}

/**
 * What to despawn and spawn to make the surface match the projection. `present`
 * maps the keys the surface holds to their signature, so a node whose position
 * or count moved is replaced exactly once.
 */
export function graphReconcile(
  nodes: readonly TypeGraphNode[],
  present: ReadonlyMap<string, string>,
): GraphReconcilePlan {
  const desired = new Map(nodes.map((node) => [node.key, graphNodeSignature(node)]));
  const remove: string[] = [];
  for (const [key, signature] of present) {
    if (desired.get(key) !== signature) remove.push(key);
  }
  const spawn = nodes.filter((node) => present.get(node.key) !== desired.get(node.key));
  return { remove, spawn };
}
