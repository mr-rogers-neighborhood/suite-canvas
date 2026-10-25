import type { Card, Connector, EdgeEndpointKind, Placement, Section } from "@suite/graph";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./multiSelect";

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
  /** Connectors live on the card, not the placement. */
  cards: readonly Pick<Card, "id" | "connectors">[];
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
    // A board endpoint is anchored at its portal; that portal's own connectors
    // are addressed as card endpoints on the portal card.
    default:
      return undefined;
  }
}

/** A normalised point (0..1 within the rect) as a flow-space anchor. */
export function anchorOnRect(rect: LinkRect, position: { x: number; y: number }): LinkAnchor {
  return {
    x: rect.x + rect.width * clamp01(position.x),
    y: rect.y + rect.height * clamp01(position.y),
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
  if (connector) return anchorOnRect(rect, connector);
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

/** The topmost endpoint under a point, so a dropped link knows what it hit. */
export function endpointAtPoint(
  point: LinkAnchor,
  boardId: string,
  scene: LinkScene,
): LinkEndpointRef | null {
  const onBoard = scene.sections.filter((section) => section.boardId === boardId);
  // Cards paint above sections, so a card wins when the point is in both.
  for (const placement of scene.placements) {
    if (placement.boardId !== boardId) continue;
    const rect = endpointRect({ kind: "card", id: placement.cardId }, boardId, scene);
    if (rect && rectContains(rect, point)) return { kind: "card", id: placement.cardId };
  }
  for (const section of onBoard) {
    const rect = { x: section.x, y: section.y, width: section.width, height: section.height };
    if (rectContains(rect, point)) return { kind: "section", id: section.id };
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
