/**
 * The dev-only window onto the ICE surface.
 *
 * The canvas is imperative and GPU-drawn, so "did it work?" cannot be asked of
 * the DOM alone: a card's position is an entity component, a link's geometry
 * lives in a kind, and an overlay dot is only correct relative to a world rect
 * the browser never sees. This module publishes exactly those facts so the lab
 * runner (`scripts/ice-lab.mjs`) can assert placement instead of eyeballing a
 * screenshot.
 *
 * Two rules keep it honest:
 * - it is a *snapshot*, not state: the surface rebuilds it on a slow tick and the
 *   builder does no I/O;
 * - it is dev-only (`import.meta.env.DEV`), so nothing ships on a user's page.
 */

import type { PeerPresence } from "../collab/presence";

export interface IceDebugPoint {
  readonly x: number;
  readonly y: number;
}

export interface IceDebugRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface IceDebugBoard {
  readonly id: string;
  readonly name: string;
  readonly parentBoardId: string | null;
  readonly depth: number;
  /** The Board's rect on the View's plane. */
  readonly world: IceDebugRect;
}

export interface IceDebugSlot {
  readonly entity: number;
  readonly cardId: string;
  readonly boardId: string;
  /** The entity's own box: what a commit writes. */
  readonly local: IceDebugRect;
  /** The same box on the View's plane: what presence and links use. */
  readonly world: IceDebugRect;
}

export interface IceDebugEdge {
  readonly edgeId: string;
  /** The View or Board whose frame the link is drawn in. */
  readonly frame: string;
  readonly from: IceDebugPoint;
  readonly to: IceDebugPoint;
  readonly kind: string;
  readonly label: string | null;
  /** The end that names a Board, when one does (ADR-0041); card ends are null. */
  readonly sourceKind: string | null;
  readonly targetKind: string | null;
  /** The entity's own box — what ICE culls and picks by, after `follow()`. */
  readonly box?: IceDebugRect | null;
}

export interface IceDebugOverlays {
  readonly connectorDots: readonly IceDebugPoint[];
  readonly cursors: readonly (IceDebugPoint & {
    readonly name: string;
    readonly board: string | null;
  })[];
  readonly rings: readonly IceDebugRect[];
  readonly ghosts: readonly IceDebugRect[];
  readonly marquee: IceDebugRect | null;
  readonly connectorDrag: { readonly from: IceDebugPoint; readonly to: IceDebugPoint } | null;
}

export interface IceDebugPeer {
  readonly clientId: string;
  readonly name: string;
  readonly board: string | null;
  readonly boardOf: string | null;
  readonly pointer: IceDebugPoint | null;
}

export interface IceDebugSnapshot {
  readonly at: number;
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number } | null;
  /** The Board whose inside is on screen, outermost first; empty on the plane. */
  readonly entered: readonly { readonly id: string; readonly name: string }[];
  readonly boards: readonly IceDebugBoard[];
  readonly slots: readonly IceDebugSlot[];
  readonly edges: readonly IceDebugEdge[];
  readonly overlays: IceDebugOverlays;
  readonly peers: readonly IceDebugPeer[];
  readonly selection: readonly string[];
}

export interface IceDebugInput {
  readonly at: number;
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number } | null;
  readonly entered: readonly { readonly id: string; readonly name: string }[];
  readonly boards: readonly IceDebugBoard[];
  readonly slots: readonly IceDebugSlot[];
  readonly edges: readonly IceDebugEdge[];
  readonly overlays: IceDebugOverlays;
  readonly peers: Readonly<Record<string, PeerPresence>>;
  readonly selection: readonly string[];
}

export const EMPTY_OVERLAYS: IceDebugOverlays = Object.freeze({
  connectorDots: Object.freeze([]),
  cursors: Object.freeze([]),
  rings: Object.freeze([]),
  ghosts: Object.freeze([]),
  marquee: null,
  connectorDrag: null,
});

function usable(value: number): boolean {
  return Number.isFinite(value);
}

function usableRect(rect: IceDebugRect | null | undefined): rect is IceDebugRect {
  return (
    rect !== null &&
    rect !== undefined &&
    usable(rect.x) &&
    usable(rect.y) &&
    usable(rect.width) &&
    usable(rect.height)
  );
}

function cleanPoint(point: IceDebugPoint): IceDebugPoint {
  return { x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)) };
}

function cleanRect(rect: IceDebugRect): IceDebugRect {
  return {
    x: Number(rect.x.toFixed(2)),
    y: Number(rect.y.toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
  };
}

/**
 * Build one snapshot. Rounded to hundredths so a diff is about placement rather
 * than floating-point noise; unusable samples are dropped rather than published
 * as `NaN`.
 */
export function buildIceDebugSnapshot(input: IceDebugInput): IceDebugSnapshot {
  const slots = input.slots
    .filter((slot) => usableRect(slot.local) && usableRect(slot.world))
    .map((slot) => ({ ...slot, local: cleanRect(slot.local), world: cleanRect(slot.world) }));

  const edges = input.edges
    .filter((edge) => usable(edge.from.x) && usable(edge.from.y))
    .filter((edge) => usable(edge.to.x) && usable(edge.to.y))
    .map((edge) => ({
      ...edge,
      from: cleanPoint(edge.from),
      to: cleanPoint(edge.to),
    }));

  const peers = Object.entries(input.peers)
    .map(([clientId, peer]) => ({
      clientId,
      name: peer.user.name,
      board: peer.board,
      boardOf: peer.boardOf,
      pointer: peer.pointer === null ? null : cleanPoint({ x: peer.pointer.x, y: peer.pointer.y }),
    }))
    .sort((a, b) => a.clientId.localeCompare(b.clientId));

  const overlays: IceDebugOverlays = {
    connectorDots: input.overlays.connectorDots.map(cleanPoint),
    cursors: input.overlays.cursors.map((cursor) => ({
      ...cleanPoint(cursor),
      name: cursor.name,
      board: cursor.board,
    })),
    rings: input.overlays.rings.filter(usableRect).map(cleanRect),
    ghosts: input.overlays.ghosts.filter(usableRect).map(cleanRect),
    marquee:
      input.overlays.marquee !== null && usableRect(input.overlays.marquee)
        ? cleanRect(input.overlays.marquee)
        : null,
    connectorDrag:
      input.overlays.connectorDrag === null
        ? null
        : {
            from: cleanPoint(input.overlays.connectorDrag.from),
            to: cleanPoint(input.overlays.connectorDrag.to),
          },
  };

  return {
    at: Math.round(input.at),
    camera: input.camera,
    entered: [...input.entered],
    boards: input.boards
      .filter((board) => usableRect(board.world))
      .map((board) => ({
        ...board,
        world: cleanRect(board.world),
      })),
    slots,
    edges,
    overlays,
    peers,
    selection: [...input.selection],
  };
}

/** The selectors the overlay layers render; kept here so the reader has one source. */
const SELECTORS = {
  dot: '[data-testid="suite-connector-dot"]',
  cursor: '[data-testid="ice-presence-cursor"]',
  cursorLabel: '[data-testid="ice-presence-cursor-label"]',
  ring: '[data-testid="ice-presence-ring"]',
  ghost: '[data-testid="ice-presence-ghost"]',
  marquee: '[data-testid="ice-presence-marquee"]',
  drag: '[data-testid="suite-connector-drag"]',
} as const;

function rectIn(host: Element, element: Element): IceDebugRect | null {
  const box = element.getBoundingClientRect();
  const frame = host.getBoundingClientRect();
  const rect = {
    x: box.x - frame.x,
    y: box.y - frame.y,
    width: box.width,
    height: box.height,
  };
  return usableRect(rect) ? rect : null;
}

/**
 * Read the screen-space layers. This is the only DOM half of the bridge: the
 * layers are plain elements, so their geometry *is* the answer for "is that dot
 * on the card?".
 */
export function readIceOverlays(host: HTMLElement | null): IceDebugOverlays {
  if (host === null) return EMPTY_OVERLAYS;

  const dots: IceDebugPoint[] = [];
  for (const dot of host.querySelectorAll(SELECTORS.dot)) {
    const rect = rectIn(host, dot);
    if (rect === null) continue;
    dots.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  }

  const cursors: (IceDebugPoint & { name: string; board: string | null })[] = [];
  for (const cursor of host.querySelectorAll(SELECTORS.cursor)) {
    const rect = rectIn(host, cursor);
    if (rect === null) continue;
    const label = cursor.querySelector(SELECTORS.cursorLabel)?.textContent ?? "";
    const [name, board] = label.split(" · ");
    cursors.push({ x: rect.x, y: rect.y, name: name ?? "", board: board ?? null });
  }

  const rects = (selector: string): IceDebugRect[] => {
    const out: IceDebugRect[] = [];
    for (const element of host.querySelectorAll(selector)) {
      const rect = rectIn(host, element);
      if (rect !== null) out.push(rect);
    }
    return out;
  };

  const marquee = host.querySelector(SELECTORS.marquee);
  const marqueeRect = marquee === null ? null : rectIn(host, marquee);
  const drag = host.querySelector(SELECTORS.drag);
  const dragLine =
    drag === null
      ? null
      : {
          from: {
            x: Number(drag.getAttribute("x1") ?? 0),
            y: Number(drag.getAttribute("y1") ?? 0),
          },
          to: {
            x: Number(drag.getAttribute("x2") ?? 0),
            y: Number(drag.getAttribute("y2") ?? 0),
          },
        };

  return {
    connectorDots: dots,
    cursors,
    rings: rects(SELECTORS.ring),
    ghosts: rects(SELECTORS.ghost),
    marquee: marqueeRect,
    connectorDrag: dragLine,
  };
}

/** Where the lab runner reads it. Absent on a page that is not in dev. */
export const ICE_DEBUG_GLOBAL = "__suiteIce";

export function publishIceDebug(
  snapshot: IceDebugSnapshot,
  target: Record<string, unknown> | undefined = typeof window === "undefined"
    ? undefined
    : (window as unknown as Record<string, unknown>),
): void {
  if (target === undefined) return;
  target[ICE_DEBUG_GLOBAL] = snapshot;
}
