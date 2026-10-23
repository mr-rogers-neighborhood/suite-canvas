import type { Connector } from "@suite/graph";
import {
  type CardInstance,
  type LodBand,
  type Point,
  RESIZE_HANDLES,
  type Rect,
  type ResizeHandle,
  type Scene,
  type Transform,
} from "@suite/scene";

/**
 * Selection chrome shared by the pointer surface and the rendered overlay.
 * Both read the same handle boxes, so a handle the user sees is exactly the
 * box the gesture hit test uses.
 */

/** Handle side in CSS pixels; divided by the camera zoom to stay constant on screen. */
export const RESIZE_HANDLE_SCREEN_SIZE = 9;

/** Extra screen-space slack around a handle so small targets stay grabbable. */
export const RESIZE_HANDLE_SLOP = 3;

/** Handles that resize on both axes win over edge handles when boxes overlap. */
const HANDLE_PICK_ORDER: readonly ResizeHandle[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];

export interface SceneResizeTarget {
  /** Instance key; `resizeFromHandle` resolves the same key. */
  readonly instanceKey: string;
  readonly cardId: string | null;
  readonly sectionId: string | null;
  /** Page-space box at the moment the target was resolved. */
  readonly rect: Rect;
  /** Board-space box, so a resize can start from canonical geometry. */
  readonly local: Rect;
  readonly transform: Transform;
  readonly lod: LodBand;
}

function safeZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/**
 * Multiplier that turns a screen-space chrome length into page space, so
 * selection rings and handles keep a constant size at any zoom.
 */
export function sceneChromeScale(zoom: number): number {
  return 1 / safeZoom(zoom);
}

/** Page-space handle side for a camera zoom, so handles keep their screen size. */
export function resizeHandlePageSize(zoom: number): number {
  return RESIZE_HANDLE_SCREEN_SIZE / safeZoom(zoom);
}

export function resizeHandleSlop(zoom: number): number {
  return RESIZE_HANDLE_SLOP / safeZoom(zoom);
}

/** Boxes for every handle, centred on the corners and edge midpoints. */
export function resizeHandleBoxes(rect: Rect, size: number): Record<ResizeHandle, Rect> {
  const half = size / 2;
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;
  const centres: Record<ResizeHandle, { x: number; y: number }> = {
    n: { x: midX, y: rect.y },
    ne: { x: maxX, y: rect.y },
    e: { x: maxX, y: midY },
    se: { x: maxX, y: maxY },
    s: { x: midX, y: maxY },
    sw: { x: rect.x, y: maxY },
    w: { x: rect.x, y: midY },
    nw: { x: rect.x, y: rect.y },
  };
  const boxes = {} as Record<ResizeHandle, Rect>;
  for (const handle of RESIZE_HANDLES) {
    const centre = centres[handle];
    boxes[handle] = { x: centre.x - half, y: centre.y - half, width: size, height: size };
  }
  return boxes;
}

function contains(box: Rect, point: { x: number; y: number }, slack: number): boolean {
  return (
    point.x >= box.x - slack &&
    point.x <= box.x + box.width + slack &&
    point.y >= box.y - slack &&
    point.y <= box.y + box.height + slack
  );
}

/** Handle under a page-space point, preferring corners over edges. */
export function resizeHandleAt(
  rect: Rect,
  point: { x: number; y: number },
  size: number,
  slack = 0,
): ResizeHandle | null {
  const boxes = resizeHandleBoxes(rect, size);
  for (const handle of HANDLE_PICK_ORDER) {
    if (contains(boxes[handle], point, slack)) return handle;
  }
  return null;
}

export function resizeHandleCursor(handle: ResizeHandle): string {
  if (handle === "nw" || handle === "se") return "nwse-resize";
  if (handle === "ne" || handle === "sw") return "nesw-resize";
  if (handle === "n" || handle === "s") return "ns-resize";
  return "ew-resize";
}

/** True when the card is drawn large enough for handles to be meaningful. */
function resizableLod(card: CardInstance): boolean {
  return card.lod === "full" || card.lod === "compact";
}

/**
 * The single selected card that may show resize handles. Selection is by
 * canonical card id, so the first instance of that card at a readable LOD owns
 * the handles; a portal card resolves to its card instance because that is the
 * key `resizeFromHandle` understands.
 */
export function resolveResizeTarget(
  scene: Scene,
  selectedIds: readonly string[],
): SceneResizeTarget | null {
  if (selectedIds.length !== 1) return null;
  const cardId = selectedIds[0];
  if (!cardId) return null;
  for (const card of scene.cards) {
    if (card.cardId !== cardId) continue;
    if (!resizableLod(card)) continue;
    return {
      instanceKey: card.key,
      cardId: card.cardId,
      sectionId: null,
      rect: card.rect,
      local: card.local,
      transform: card.transform,
      lod: card.lod,
    };
  }
  return null;
}

/**
 * The selected section that may show resize handles. Section selection is a
 * single canonical id, so the first visible instance of it owns the handles.
 */
export function resolveSectionResizeTarget(
  scene: Scene,
  sectionId: string | null,
): SceneResizeTarget | null {
  if (!sectionId) return null;
  for (const section of scene.sections) {
    if (section.sectionId !== sectionId) continue;
    if (section.lod === "hidden") continue;
    return {
      instanceKey: section.key,
      cardId: null,
      sectionId: section.sectionId,
      rect: section.rect,
      local: section.local,
      transform: section.transform,
      lod: section.lod,
    };
  }
  return null;
}

/* -------------------------------------------------------- connector handles */

/** Handle side in CSS pixels; divided by the zoom so it stays constant on screen. */
export const CONNECTOR_HANDLE_SCREEN_SIZE = 10;

/** Extra screen-space slack around a connector handle. */
export const CONNECTOR_HANDLE_SLOP = 3;

/** Screen-space gap between the card edge and the handle centre. */
export const CONNECTOR_HANDLE_SCREEN_OFFSET = 12;

export type ConnectorSide = "n" | "e" | "s" | "w";

const CONNECTOR_SIDES: readonly ConnectorSide[] = ["n", "e", "s", "w"];

const SIDE_ANCHOR: Record<ConnectorSide, Point> = {
  n: { x: 0.5, y: 0 },
  e: { x: 1, y: 0.5 },
  s: { x: 0.5, y: 1 },
  w: { x: 0, y: 0.5 },
};

const SIDE_OUTWARD: Record<ConnectorSide, Point> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

export function connectorHandlePageSize(zoom: number): number {
  return CONNECTOR_HANDLE_SCREEN_SIZE / safeZoom(zoom);
}

export function connectorHandleSlop(zoom: number): number {
  return CONNECTOR_HANDLE_SLOP / safeZoom(zoom);
}

export function connectorHandlePageOffset(zoom: number): number {
  return CONNECTOR_HANDLE_SCREEN_OFFSET / safeZoom(zoom);
}

/** One draggable side midpoint of a selected card, in page space. */
export interface SceneConnectorHandle {
  /** Stable key; one handle per side of one card instance. */
  readonly key: string;
  readonly instanceKey: string;
  readonly cardId: string;
  readonly boardId: string;
  /** Canonical connector on that side, when the card has one. */
  readonly connectorId: string | null;
  readonly side: ConnectorSide;
  /** Page-space centre the handle is drawn at. */
  readonly point: Point;
  /** Page-space hit box, matching the drawn handle. */
  readonly rect: Rect;
}

/** Connector id sitting on a side midpoint, so a new edge anchors where it looks. */
export function connectorIdForSide(
  connectors: readonly Connector[],
  side: ConnectorSide,
): string | null {
  const anchor = SIDE_ANCHOR[side];
  for (const connector of connectors) {
    if (Math.abs(connector.x - anchor.x) < 0.01 && Math.abs(connector.y - anchor.y) < 0.01) {
      return connector.id;
    }
  }
  return null;
}

/** Side of `rect` closest to a page-space point; used to anchor a dropped edge. */
export function nearestConnectorSide(rect: Rect, point: Point): ConnectorSide {
  let best: ConnectorSide = "e";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const side of CONNECTOR_SIDES) {
    const anchor = SIDE_ANCHOR[side];
    const distance = Math.hypot(
      rect.x + anchor.x * rect.width - point.x,
      rect.y + anchor.y * rect.height - point.y,
    );
    if (distance < bestDistance) {
      best = side;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The four side-midpoint handles of the single selected card, pushed just
 * outside its box so they never sit on top of a resize handle.
 */
export function resolveConnectorHandles(
  scene: Scene,
  selectedIds: readonly string[],
  connectorsFor: ((cardId: string) => readonly Connector[]) | undefined,
): SceneConnectorHandle[] {
  if (!connectorsFor || selectedIds.length !== 1) return [];
  const cardId = selectedIds[0];
  if (!cardId) return [];
  const card = scene.cards.find(
    (candidate) =>
      candidate.cardId === cardId && candidate.portalKey === null && resizableLod(candidate),
  );
  if (!card) return [];
  const connectors = connectorsFor(cardId);
  const offset = connectorHandlePageOffset(scene.camera.zoom);
  const size = connectorHandlePageSize(scene.camera.zoom);

  return CONNECTOR_SIDES.map((side) => {
    const anchor = SIDE_ANCHOR[side];
    const outward = SIDE_OUTWARD[side];
    const point: Point = {
      x: card.rect.x + anchor.x * card.rect.width + outward.x * offset,
      y: card.rect.y + anchor.y * card.rect.height + outward.y * offset,
    };
    return {
      key: `${card.key}:${side}`,
      instanceKey: card.key,
      cardId: card.cardId,
      boardId: card.boardId,
      connectorId: connectorIdForSide(connectors, side),
      side,
      point,
      rect: { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size },
    };
  });
}

/** Connector handle under a page-space point, if any. */
export function connectorHandleAt(
  handles: readonly SceneConnectorHandle[],
  point: Point,
  slack = 0,
): SceneConnectorHandle | null {
  for (const handle of handles) {
    if (contains(handle.rect, point, slack)) return handle;
  }
  return null;
}
