import type { Card, Connector, EdgeEndpointKind, Placement, Section } from "@suite/graph";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../interactions/multiSelect";
import { edgePoint } from "../silhouette";

/** A rectangle in flow coordinates, the only space a link is ever drawn in. */
export interface LinkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LinkAnchor {
  x: number;
  y: number;
}

/** One end of a link, as the canvas understands it while drawing. */
export interface LinkEndpointRef {
  kind: EdgeEndpointKind;
  id: string;
  /** Set when the end is attached to a specific connector dot. */
  connectorId?: string | undefined;
}

/** Everything endpoint resolution needs, all of it already in the snapshot. */
export interface LinkScene {
  placements: readonly Placement[];
  sections: readonly Section[];
  /**
   * Connectors live on the card, not the placement, and so does the radius that decides
   * where its painted edge is: a corner dot is drawn on the arc, so an anchor resolved
   * from the box would start a line off the dot (ADR-0071 amendment).
   */
  cards: readonly (Pick<Card, "id" | "connectors"> & { radius?: number })[];
  /** One entry per portal card: where it sits and which board it opens. */
  portals: readonly { boardId: string; cardId: string; targetBoardId: string }[];
}

/**
 * The rect a link endpoint occupies on the current board, or null when the
 * endpoint cannot be drawn here — a card placed elsewhere, a section on another
 * board, or a board with no portal pointing at it.
 */
export function endpointRect(
  endpoint: LinkEndpointRef,
  boardId: string,
  scene: LinkScene,
): LinkRect | null {
  switch (endpoint.kind) {
    case "card": {
      const placement = scene.placements.find(
        (entry) => entry.boardId === boardId && entry.cardId === endpoint.id,
      );
      if (!placement) return null;
      return {
        x: placement.x,
        y: placement.y,
        width: placement.width ?? DEFAULT_CARD_WIDTH,
        height: placement.height ?? DEFAULT_CARD_HEIGHT,
      };
    }
    case "section": {
      const section = scene.sections.find(
        (entry) => entry.boardId === boardId && entry.id === endpoint.id,
      );
      if (!section) return null;
      return { x: section.x, y: section.y, width: section.width, height: section.height };
    }
    case "board": {
      const portal = scene.portals.find(
        (entry) => entry.boardId === boardId && entry.targetBoardId === endpoint.id,
      );
      if (!portal) return null;
      return endpointRect({ kind: "card", id: portal.cardId }, boardId, scene);
    }
    default:
      return null;
  }
}

/** The connector an endpoint attaches to, when that connector still exists. */
export function endpointConnector(
  endpoint: LinkEndpointRef,
  boardId: string,
  scene: LinkScene,
): Connector | undefined {
  if (!endpoint.connectorId) return undefined;

  switch (endpoint.kind) {
    case "card": {
      if (!endpointRect(endpoint, boardId, scene)) return undefined;
      return scene.cards
        .find((card) => card.id === endpoint.id)
        ?.connectors.find((connector) => connector.id === endpoint.connectorId);
    }
    case "section": {
      const section = scene.sections.find(
        (entry) => entry.boardId === boardId && entry.id === endpoint.id,
      );
      return section?.connectors?.find((connector) => connector.id === endpoint.connectorId);
    }
    case "board": {
      // A board is drawn at its portal, so the connector the user released on is
      // the portal's connector. Without this the line always falls back to the
      // side nearest the other end, which is never the dot that was aimed at.
      const portal = scene.portals.find(
        (entry) => entry.boardId === boardId && entry.targetBoardId === endpoint.id,
      );
      if (!portal) return undefined;
      return scene.cards
        .find((card) => card.id === portal.cardId)
        ?.connectors.find((connector) => connector.id === endpoint.connectorId);
    }
    default:
      return undefined;
  }
}

/**
 * A normalised point (0..1 within the rect) as a flow-space anchor.
 *
 * `radius` is the silhouette the surface paints. It defaults to zero because most
 * callers are sections and hand-made rects, whose dots sit on the box; a card passes the
 * radius it resolved, so the anchor lands on the same arc its dot is drawn on.
 */
export function anchorOnRect(
  rect: LinkRect,
  position: { x: number; y: number },
  radius = 0,
): LinkAnchor {
  const point =
    radius > 0 ? edgePoint({ width: rect.width, height: rect.height, radius }, position) : position;
  return {
    x: rect.x + rect.width * clamp01(point.x),
    y: rect.y + rect.height * clamp01(point.y),
  };
}

/**
 * The side midpoint of a rect that faces `toward`, so a link without a connector
 * leaves from the edge closest to the other end.
 */
export function nearestSideAnchor(rect: LinkRect, toward: LinkAnchor): LinkAnchor {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? rect.x + rect.width : rect.x, y: center.y };
  }
  return { x: center.x, y: dy >= 0 ? rect.y + rect.height : rect.y };
}

/** The silhouette radius a card resolved; sections and boards paint their own box. */
function radiusOf(endpoint: LinkEndpointRef, scene: LinkScene): number {
  if (endpoint.kind !== "card") return 0;
  const radius = scene.cards.find((entry) => entry.id === endpoint.id)?.radius;
  return typeof radius === "number" && Number.isFinite(radius) && radius > 0 ? radius : 0;
}

/** Where one end sits: its connector if it has one, else the facing side. */
export function endpointAnchor(
  endpoint: LinkEndpointRef,
  boardId: string,
  scene: LinkScene,
  toward: LinkAnchor,
): LinkAnchor | null {
  const rect = endpointRect(endpoint, boardId, scene);
  if (!rect) return null;

  const connector = endpointConnector(endpoint, boardId, scene);
  if (connector) return anchorOnRect(rect, connector, radiusOf(endpoint, scene));
  return nearestSideAnchor(rect, toward);
}

/**
 * Both ends of a link resolved on one board, or null when either end cannot be
 * drawn there. Callers keep the link in the document either way; this only
 * decides whether a line appears.
 */
export function linkAnchors(
  endpoints: { source: LinkEndpointRef; target: LinkEndpointRef },
  boardId: string,
  scene: LinkScene,
): { source: LinkAnchor; target: LinkAnchor } | null {
  const sourceRect = endpointRect(endpoints.source, boardId, scene);
  const targetRect = endpointRect(endpoints.target, boardId, scene);
  if (!sourceRect || !targetRect) return null;

  const sourceCenter = centerOf(sourceRect);
  const targetCenter = centerOf(targetRect);

  const source = endpointAnchor(endpoints.source, boardId, scene, targetCenter);
  const target = endpointAnchor(endpoints.target, boardId, scene, sourceCenter);
  if (!source || !target) return null;
  return { source, target };
}

/** True when a point lands inside a rect, used for link drop targets. */
export function rectContains(rect: LinkRect, point: LinkAnchor): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * True when a link's straight run crosses a box, which is what a selection box
 * catches. The drawn path bends a little, but the anchors are what a reader aims
 * at: a box drawn over the line's ends or across its span both count.
 */
export function segmentCrossesRect(from: LinkAnchor, to: LinkAnchor, rect: LinkRect): boolean {
  if (rectContains(rect, from) || rectContains(rect, to)) return true;
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  // Liang–Barsky: clip the segment to each edge's half-plane in turn.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let enter = 0;
  let exit = 1;
  const edges: readonly [number, number][] = [
    [-dx, from.x - left],
    [dx, right - from.x],
    [-dy, from.y - top],
    [dy, bottom - from.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > exit) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < exit) exit = t;
    }
  }
  return true;
}

/** The topmost endpoint under a point, so a dropped link knows what it hit. */
export function endpointAtPoint(
  point: LinkAnchor,
  boardId: string,
  scene: LinkScene,
): LinkEndpointRef | null {
  const onBoard = scene.sections.filter((section) => section.boardId === boardId);
  // Cards paint above sections, so a card wins when the point is in both. Among
  // cards the topmost one wins: paint order is `z`, then creation, which is what
  // the user sees when a portal sits over the card that opened it.
  let topmost: { cardId: string; z: number; createdAt: number } | null = null;
  for (const placement of scene.placements) {
    if (placement.boardId !== boardId) continue;
    const rect = endpointRect({ kind: "card", id: placement.cardId }, boardId, scene);
    if (!rect || !rectContains(rect, point)) continue;
    const above =
      topmost === null ||
      placement.z > topmost.z ||
      (placement.z === topmost.z && placement.createdAt >= topmost.createdAt);
    if (above) {
      topmost = { cardId: placement.cardId, z: placement.z, createdAt: placement.createdAt };
    }
  }
  if (topmost) return { kind: "card", id: topmost.cardId };
  for (const section of onBoard) {
    const rect = { x: section.x, y: section.y, width: section.width, height: section.height };
    if (rectContains(rect, point)) return { kind: "section", id: section.id };
  }
  return null;
}

/**
 * The connector dot under a point, on the topmost card or section, within
 * `radius` flow units. A link released on a dot must keep that dot: resolving
 * the drop by shape alone loses which of the four sides the user aimed at, and
 * the line then leaves from whichever edge happens to face the other end.
 *
 * Containment is deliberately not required. A dot sits *on* its entity's edge,
 * so its centre is on the boundary — and half the time a pixel outside it, which
 * is how a release that visibly landed on a dot resolved to nothing at all.
 */
export function connectorAtPoint(
  point: LinkAnchor,
  boardId: string,
  scene: LinkScene,
  radius: number,
): LinkEndpointRef | null {
  const nearest = (
    connectors: readonly Connector[] | undefined,
    rect: LinkRect,
    shapeRadius: number,
  ) => {
    let best: { id: string; distance: number } | null = null;
    for (const connector of connectors ?? []) {
      const anchor = anchorOnRect(rect, connector, shapeRadius);
      const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
      if (distance > radius) continue;
      if (!best || distance < best.distance) best = { id: connector.id, distance };
    }
    return best?.id;
  };

  // Same paint order as `endpointAtPoint`: cards above sections, topmost first.
  const ranked = scene.placements
    .filter((placement) => placement.boardId === boardId)
    .sort((left, right) => right.z - left.z || right.createdAt - left.createdAt);
  for (const placement of ranked) {
    const rect = endpointRect({ kind: "card", id: placement.cardId }, boardId, scene);
    const card = scene.cards.find((entry) => entry.id === placement.cardId);
    if (!rect || !card) continue;
    const connectorId = nearest(
      card.connectors,
      rect,
      radiusOf({ kind: "card", id: card.id }, scene),
    );
    if (connectorId) return { kind: "card", id: card.id, connectorId };
  }

  for (const section of scene.sections) {
    if (section.boardId !== boardId) continue;
    const rect = { x: section.x, y: section.y, width: section.width, height: section.height };
    const connectorId = nearest(section.connectors, rect, 0);
    if (connectorId) return { kind: "section", id: section.id, connectorId };
  }
  return null;
}

function centerOf(rect: LinkRect): LinkAnchor {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
