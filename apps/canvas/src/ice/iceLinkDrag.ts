/**
 * Drawing a link by hand: from a card's connector to another card's connector.
 *
 * The document already knows how to make one edge (`planEdgeCreate` → one
 * `addEdge` write). What was missing is the gesture: where it may start, what
 * the pointer is aimed at, and when a drag is a drag rather than a click. All
 * of that lives here, in world units, with no DOM and no ICE — the surface
 * supplies the camera and the entities, and commits exactly once at pointer-up.
 *
 * A connector is the card's own data (`card.connectors`, 0..1 fractions), not
 * an ICE port: ports are per kind and side-only, and a Suite card may put a
 * connector anywhere on its perimeter. The anchors below are the same geometry
 * `anchorWorld` uses to draw the link, so what the pointer aims at and what the
 * link leaves cannot disagree.
 */

import type { Connector } from "@suite/graph";
import type { Point, Rect } from "@suite/scene";
import type { ConnectState } from "../collab/presence";
import type { IceEdgeCreateIntent } from "./iceBridge";

/** How close (CSS px) a press must be to a connector to start a link. */
export const LINK_HOTSPOT_PX = 10;

/** Below this much travel (CSS px) a link drag is a click on the connector. */
export const LINK_DRAG_MIN_PX = 4;

/** A connector's world anchor, with the id the document stores. */
export interface ConnectorAnchor {
  readonly connectorId: string;
  readonly point: Point;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finitePoint(point: Point | null | undefined): point is Point {
  return point !== null && point !== undefined && finite(point.x) && finite(point.y);
}

function usableRect(rect: Rect | null | undefined): rect is Rect {
  return (
    rect !== null &&
    rect !== undefined &&
    finite(rect.x) &&
    finite(rect.y) &&
    finite(rect.width) &&
    finite(rect.height)
  );
}

/** The screen-space radius of the press hotspot, in world units at `zoom`. */
export function linkHotspotRadius(zoom: number): number {
  if (!finite(zoom) || zoom <= 0) return LINK_HOTSPOT_PX;
  return LINK_HOTSPOT_PX / zoom;
}

/** The world minimum travel that makes a link drag a drag, at `zoom`. */
export function linkMinTravel(zoom: number): number {
  if (!finite(zoom) || zoom <= 0) return LINK_DRAG_MIN_PX;
  return LINK_DRAG_MIN_PX / zoom;
}

/** Every connector of a card as a world point, in the card's own order. */
export function connectorAnchors(
  connectors: readonly Connector[],
  rect: Rect | null | undefined,
): ConnectorAnchor[] {
  if (!usableRect(rect)) return [];
  const anchors: ConnectorAnchor[] = [];
  for (const connector of connectors) {
    if (!finite(connector.x) || !finite(connector.y)) continue;
    anchors.push({
      connectorId: connector.id,
      point: {
        x: rect.x + Math.min(1, Math.max(0, connector.x)) * rect.width,
        y: rect.y + Math.min(1, Math.max(0, connector.y)) * rect.height,
      },
    });
  }
  return anchors;
}

/** The connector within `radius` of `point`, nearest first; null when none is. */
export function connectorAt(
  anchors: readonly ConnectorAnchor[],
  point: Point | null | undefined,
  radius: number,
): ConnectorAnchor | null {
  // An infinite radius is the "nearest, wherever it is" case; NaN is not a radius.
  if (!finitePoint(point) || Number.isNaN(radius) || radius < 0) return null;
  let best: ConnectorAnchor | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const distance = Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y);
    if (distance > radius || distance >= bestDistance) continue;
    best = anchor;
    bestDistance = distance;
  }
  return best;
}

/** The connector closest to `point`, whatever the distance; null when there are none. */
export function nearestConnector(
  anchors: readonly ConnectorAnchor[],
  point: Point | null | undefined,
): ConnectorAnchor | null {
  if (!finitePoint(point)) return null;
  return connectorAt(anchors, point, Number.POSITIVE_INFINITY);
}

/**
 * One end of a link being drawn. A card end comes from a connector; a Board end
 * comes from a wall (ADR-0041) and names no connector at all.
 */
export interface LinkEnd {
  readonly kind: "card" | "board";
  /** The card id, or the Board's id when `kind` is board. */
  readonly id: string;
  /** The card's connector; absent on a Board end. */
  readonly connectorId?: string | undefined;
  /** The anchor in world units. */
  readonly point: Point;
}

export interface LinkDragTarget extends LinkEnd {
  readonly kind: "card" | "board";
  readonly id: string;
  readonly point: Point;
}

/** The four side midpoints of a Board's frame — where a link may leave it. */
export function boardAnchors(rect: Rect | null | undefined): ConnectorAnchor[] {
  if (!usableRect(rect)) return [];
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  return [
    { connectorId: "side:north", point: { x: midX, y: rect.y } },
    { connectorId: "side:east", point: { x: rect.x + rect.width, y: midY } },
    { connectorId: "side:south", point: { x: midX, y: rect.y + rect.height } },
    { connectorId: "side:west", point: { x: rect.x, y: midY } },
  ];
}

export interface LinkDragState {
  readonly boardId: string;
  /** The end the gesture started from. */
  readonly source: LinkEnd;
  /** The source anchor in world units. */
  readonly anchor: Point;
  /** Where the press started, for the click-versus-drag test. */
  readonly pressed: Point;
  readonly pointer: Point;
  /** The end the pointer is over, if it is one that can take a link. */
  readonly target: LinkDragTarget | null;
  /** World units of travel below which the drag is a click. */
  readonly minTravel: number;
}

/** Start a link drag from a connector (a card) or a side anchor (a Board). */
export function beginLinkDrag(input: {
  readonly boardId: string;
  /** The card id, or the Board's id when `kind` is board. */
  readonly id: string;
  readonly kind?: "card" | "board" | undefined;
  /** Required for a card end; a Board end names no connector. */
  readonly connectorId?: string | undefined;
  readonly anchor: Point | null | undefined;
  readonly pointer: Point | null | undefined;
  readonly minTravel?: number | undefined;
}): LinkDragState | null {
  const kind = input.kind ?? "card";
  if (input.boardId.length === 0 || input.id.length === 0) return null;
  if (kind === "card" && (input.connectorId ?? "").length === 0) return null;
  if (!finitePoint(input.anchor) || !finitePoint(input.pointer)) return null;
  return {
    boardId: input.boardId,
    source: {
      kind,
      id: input.id,
      ...(kind === "card" && input.connectorId !== undefined
        ? { connectorId: input.connectorId }
        : {}),
      point: input.anchor,
    },
    anchor: input.anchor,
    pressed: input.pointer,
    pointer: input.pointer,
    target: null,
    minTravel: finite(input.minTravel ?? 0) ? (input.minTravel ?? 0) : 0,
  };
}

/** Move the free end. A target that names the source is not a target. */
export function moveLinkDrag(
  state: LinkDragState,
  pointer: Point | null | undefined,
  target: LinkDragTarget | null = null,
): LinkDragState {
  if (!finitePoint(pointer)) return state;
  const usable = target !== null && !sameEnd(target, state.source) ? target : null;
  return { ...state, pointer, target: usable };
}

function sameEnd(left: LinkEnd, right: LinkEnd): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/**
 * What the gesture means when the pointer lifts: one edge, or nothing.
 *
 * Nothing when there is no target, when the target is the source card (a link
 * to itself is not a link), or when the pointer never travelled far enough to
 * be a drag (a click on a connector selects, it does not link).
 */
export function endLinkDrag(state: LinkDragState | null): IceEdgeCreateIntent | null {
  if (state === null) return null;
  const target = state.target;
  if (target === null || sameEnd(target, state.source)) return null;
  const travelled = Math.hypot(
    state.pointer.x - state.pressed.x,
    state.pointer.y - state.pressed.y,
  );
  if (travelled < state.minTravel) return null;
  const end = (side: LinkEnd) => ({
    cardId: side.id,
    ...(side.kind === "board" ? { kind: "board" as const } : {}),
    ...(side.connectorId ? { connectorId: side.connectorId } : {}),
  });
  return {
    kind: "edge-create",
    boardId: state.boardId,
    source: end(state.source),
    target: end(target),
  };
}

/** The presence sample a peer needs to draw this drag while it is in flight. */
export function connectSample(state: LinkDragState): ConnectState {
  return {
    nodeId: state.source.id,
    connectorId: state.source.connectorId ?? "",
    anchorEnd: "source",
    position: { x: state.pointer.x, y: state.pointer.y },
    ...(state.target === null
      ? {}
      : {
          target: { nodeId: state.target.id, connectorId: state.target.connectorId ?? "" },
        }),
  };
}
