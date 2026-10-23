/**
 * Peer presence for the ICE surface: the pure projection from awareness
 * samples to the screen-space model the surface paints.
 *
 * Coordinate contract. ICE's camera maps world to screen as
 * `screen = (world - camera) * zoom`, so board -> screen is
 * `(p - camera) * zoom`. Every sample the surface publishes is in BOARD units
 * (ICE world == root board here), which is also the unit the scene surface
 * publishes; only the projection changes between the two surfaces.
 *
 * Nothing here owns state: the store's peer record goes in, a frame of
 * screen-space boxes comes out, and the outbound helpers turn a live gesture
 * back into a board-space sample. That keeps the surface a thin adapter and
 * makes the mapping testable without a WebGPU device.
 */

import type { Point, Rect } from "@suite/scene";
import type {
  DraggingState,
  PeerPresence,
  PointerState,
  SelectionBoxState,
  SelectionState,
} from "../collab/presence";
import type { SuiteCardCamera } from "./suiteCardOverlay";

/** ICE's camera: `screen = (world - camera) * zoom`, CSS px of the container. */
export type IcePresenceCamera = SuiteCardCamera;

/** A screen-space box in container CSS px. */
export interface IceScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** One visible instance of a card, in board units. */
export interface IcePresenceInstance {
  /** Stable identity of the instance the surface drew (entity or portal key). */
  readonly instanceKey: string;
  readonly cardId: string;
  readonly boardId: string;
  /** The instance's box in board units. */
  readonly rect: Rect;
}

/** A peer's pointer, in container CSS px. */
export interface IcePresenceCursor {
  readonly peerId: string;
  readonly name: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
}

/** A ring around one instance of a card a peer has selected. */
export interface IcePresenceRing {
  readonly peerId: string;
  readonly color: string;
  readonly cardId: string;
  /** Instance identity, so two copies of one card get two stable keys. */
  readonly instanceKey: string;
  readonly rect: IceScreenRect;
}

/** A peer's in-flight drag, drawn where each instance of the gesture lands. */
export interface IcePresenceGhost {
  readonly peerId: string;
  readonly color: string;
  readonly name: string;
  /** The dragged set, anchor first. */
  readonly nodeIds: readonly string[];
  readonly instanceKey: string;
  readonly rect: IceScreenRect;
}

/** The marquee a peer is drawing right now. */
export interface IcePresenceMarquee {
  readonly peerId: string;
  readonly color: string;
  readonly rect: IceScreenRect;
}

/** Who has the caret in a card, resolved from `focus.nodeId`. */
export interface IcePresenceEditor {
  readonly cardId: string;
  readonly peers: readonly {
    readonly peerId: string;
    readonly name: string;
    readonly color: string;
  }[];
}

/** Everything the surface paints for peers, already in screen space. */
export interface IcePresenceFrame {
  readonly cursors: readonly IcePresenceCursor[];
  readonly rings: readonly IcePresenceRing[];
  readonly ghosts: readonly IcePresenceGhost[];
  readonly marquee: IcePresenceMarquee | null;
  readonly editing: readonly IcePresenceEditor[];
}

export interface IcePresenceInput {
  /** `usePresenceStore((state) => state.peers)`, keyed by client id. */
  readonly peers: Readonly<Record<string, PeerPresence>>;
  readonly camera: IcePresenceCamera | null | undefined;
  /** Only peers looking at this board are drawn. */
  readonly boardId: string;
  /** Instances the surface currently draws, in board units. */
  readonly instances: readonly IcePresenceInstance[];
  /** Screen-space clip in container CSS px. Absent, invalid or empty: no clip. */
  readonly viewport?: IceScreenRect | null | undefined;
}

/** Reused when there is nothing to paint, so a memoised frame stays identical. */
export const EMPTY_ICE_PRESENCE_FRAME: IcePresenceFrame = Object.freeze({
  cursors: Object.freeze([]),
  rings: Object.freeze([]),
  ghosts: Object.freeze([]),
  marquee: null,
  editing: Object.freeze([]),
});

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteRect(rect: Rect | null | undefined): rect is Rect {
  if (!rect) return false;
  return finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height);
}

/** A camera we can divide by and multiply through. */
function usableCamera(camera: IcePresenceCamera | null | undefined): camera is IcePresenceCamera {
  if (!camera) return false;
  return finite(camera.x) && finite(camera.y) && finite(camera.zoom) && camera.zoom > 0;
}

function projectPoint(point: Point, camera: IcePresenceCamera): { x: number; y: number } | null {
  if (!finite(point.x) || !finite(point.y)) return null;
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}

function projectRect(rect: Rect, camera: IcePresenceCamera): IceScreenRect | null {
  if (!finiteRect(rect)) return null;
  return {
    left: (rect.x - camera.x) * camera.zoom,
    top: (rect.y - camera.y) * camera.zoom,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}

/** A viewport with no area means "not laid out yet", not "hide everything". */
function normalizeViewport(viewport: IceScreenRect | null | undefined): IceScreenRect | null {
  if (!viewport) return null;
  const { left, top, width, height } = viewport;
  if (!finite(left) || !finite(top) || !finite(width) || !finite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return viewport;
}

function viewportContainsPoint(
  viewport: IceScreenRect | null,
  point: { x: number; y: number },
): boolean {
  if (!viewport) return true;
  return (
    point.x >= viewport.left &&
    point.x <= viewport.left + viewport.width &&
    point.y >= viewport.top &&
    point.y <= viewport.top + viewport.height
  );
}

function viewportIntersectsRect(viewport: IceScreenRect | null, rect: IceScreenRect): boolean {
  if (!viewport) return true;
  return (
    rect.left <= viewport.left + viewport.width &&
    rect.left + rect.width >= viewport.left &&
    rect.top <= viewport.top + viewport.height &&
    rect.top + rect.height >= viewport.top
  );
}

function peerIdOf(key: string, peer: PeerPresence): string {
  return peer.clientId.length > 0 ? peer.clientId : key;
}

/** Every instance of `cardId` on `boardId`, in the order the surface listed them. */
function instancesOf(
  instances: readonly IcePresenceInstance[],
  cardId: string,
  boardId: string,
): IcePresenceInstance[] {
  return instances.filter((instance) => instance.cardId === cardId && instance.boardId === boardId);
}

/**
 * Project the peers of one board into screen space.
 *
 * - a peer whose `board` is not `boardId` is dropped, pointer and all;
 * - a pointer outside the viewport is dropped, not clamped;
 * - a selected card gets one ring per visible instance, however many there are;
 * - a drag becomes one ghost per visible instance of every dragged card, moved
 *   by the anchor's delta (`dragging.position` minus the anchor's stored box);
 *   without `nodeIds` only the anchor moves, and without a visible anchor
 *   instance the delta cannot be derived, so nothing is drawn;
 * - `focus` becomes an editing entry for the card, never a caret;
 * - a marquee is a single slot: when several peers draw one, the lowest peer id
 *   wins so the paint order does not depend on store insertion order.
 *
 * Non-finite samples drop out instead of poisoning a transform.
 */
export function projectPeerPresence(input: IcePresenceInput): IcePresenceFrame {
  const { camera, boardId } = input;
  if (!usableCamera(camera)) return EMPTY_ICE_PRESENCE_FRAME;

  const viewport = normalizeViewport(input.viewport);
  const instances = input.instances;
  const cursors: IcePresenceCursor[] = [];
  const rings: IcePresenceRing[] = [];
  const ghosts: IcePresenceGhost[] = [];
  const marquees: IcePresenceMarquee[] = [];
  const editors = new Map<
    string,
    { cardId: string; peers: IcePresenceEditor["peers"][number][] }
  >();

  for (const [key, peer] of Object.entries(input.peers)) {
    // Presence is workspace-wide; a peer looking at another board contributes
    // nothing here, not even a cursor at the edge.
    if (peer.board !== boardId) continue;

    const peerId = peerIdOf(key, peer);
    const { name, color } = peer.user;

    if (peer.pointer) {
      const point = projectPoint(peer.pointer, camera);
      if (point && viewportContainsPoint(viewport, point)) {
        cursors.push({ peerId, name, color, x: point.x, y: point.y });
      }
    }

    for (const cardId of peer.selection?.nodeIds ?? []) {
      for (const instance of instancesOf(instances, cardId, boardId)) {
        const rect = projectRect(instance.rect, camera);
        if (!rect || !viewportIntersectsRect(viewport, rect)) continue;
        rings.push({
          peerId,
          color,
          cardId,
          instanceKey: instance.instanceKey,
          rect,
        });
      }
    }

    const dragging = peer.dragging;
    if (dragging) {
      // A gesture published for another board has no placement here.
      const gestureBoard = dragging.boardId ?? peer.board;
      const anchor =
        gestureBoard === boardId ? instancesOf(instances, dragging.nodeId, boardId)[0] : undefined;
      if (anchor) {
        const dx = dragging.position.x - anchor.rect.x;
        const dy = dragging.position.y - anchor.rect.y;
        const nodeIds =
          dragging.nodeIds && dragging.nodeIds.length > 0 ? dragging.nodeIds : [dragging.nodeId];
        for (const cardId of nodeIds) {
          for (const instance of instancesOf(instances, cardId, boardId)) {
            const rect = projectRect(
              {
                x: instance.rect.x + dx,
                y: instance.rect.y + dy,
                width: instance.rect.width,
                height: instance.rect.height,
              },
              camera,
            );
            if (!rect || !viewportIntersectsRect(viewport, rect)) continue;
            ghosts.push({
              peerId,
              color,
              name,
              nodeIds,
              instanceKey: instance.instanceKey,
              rect,
            });
          }
        }
      }
    }

    if (peer.selectionBox) {
      const rect = projectRect(peer.selectionBox, camera);
      if (rect && viewportIntersectsRect(viewport, rect)) {
        marquees.push({ peerId, color, rect });
      }
    }

    const focus = peer.focus;
    if (focus && focus.nodeId.length > 0) {
      const entry = editors.get(focus.nodeId) ?? { cardId: focus.nodeId, peers: [] };
      entry.peers.push({ peerId, name, color });
      editors.set(focus.nodeId, entry);
    }
  }

  marquees.sort((a, b) => (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0));

  if (
    cursors.length === 0 &&
    rings.length === 0 &&
    ghosts.length === 0 &&
    editors.size === 0 &&
    marquees.length === 0
  ) {
    return EMPTY_ICE_PRESENCE_FRAME;
  }

  return {
    cursors,
    rings,
    ghosts,
    marquee: marquees[0] ?? null,
    editing: [...editors.values()],
  };
}

/* ------------------------------------------------------------- outbound */

/**
 * The pointer sample to publish from an ICE world point.
 *
 * ICE world is the root board here, so the conversion is the identity: the
 * camera is only a witness that a real camera exists. A sample taken while the
 * camera is broken (or before layout) would land at an arbitrary board point on
 * every peer, so it is dropped instead.
 */
export function pointerSample(
  worldPoint: Point | null | undefined,
  camera: IcePresenceCamera | null | undefined,
): PointerState | null {
  if (!worldPoint || !usableCamera(camera)) return null;
  if (!finite(worldPoint.x) || !finite(worldPoint.y)) return null;
  return { x: worldPoint.x, y: worldPoint.y };
}

/** Dedupe, keeping the first occurrence so the anchor stays first. */
function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * The drag sample to publish: the live gesture box (board units) becomes the
 * anchor's position, and `members` travels as the drag set so peers replay the
 * whole gesture from one payload. A single-card drag omits `nodeIds`, exactly
 * like the store's publish path.
 */
export function dragSample(
  cardId: string,
  boardId: string,
  box: Rect | null | undefined,
  members: readonly string[] = [],
): DraggingState | null {
  if (cardId.length === 0 || boardId.length === 0) return null;
  if (!finiteRect(box)) return null;
  const nodeIds = uniqueIds([cardId, ...members]);
  return {
    nodeId: cardId,
    position: { x: box.x, y: box.y },
    ...(nodeIds.length > 1 ? { nodeIds } : {}),
    boardId,
  };
}

/**
 * The selection sample to publish. Empty optional sets are omitted rather than
 * published as `[]`, so peers can tell "no link selected" from "link selection
 * not reported".
 */
export function selectionSample(
  cardIds: readonly string[],
  edgeIds: readonly string[] = [],
  sectionId?: string | null,
): SelectionState {
  const nodeIds = uniqueIds(cardIds);
  const edges = uniqueIds(edgeIds);
  return {
    nodeIds,
    ...(edges.length > 0 ? { edgeIds: edges } : {}),
    ...(sectionId ? { sectionId } : {}),
  };
}

/**
 * The marquee sample to publish, in board units. A drag up and left produces a
 * negative size; it is normalised here so every peer draws the same box.
 */
export function marqueeSample(box: Rect | null | undefined): SelectionBoxState | null {
  if (!finiteRect(box)) return null;
  return {
    x: Math.min(box.x, box.x + box.width),
    y: Math.min(box.y, box.y + box.height),
    width: Math.abs(box.width),
    height: Math.abs(box.height),
  };
}

/* ------------------------------------------------------------------ caps */

export type PresenceRole = "owner" | "editor" | "viewer";

/** What a role may publish. A viewer points and selects; it never gestures. */
export interface PresenceRoleCaps {
  readonly pointer: boolean;
  readonly selection: boolean;
  readonly drag: boolean;
  readonly resize: boolean;
  readonly marquee: boolean;
}

const EDIT_ROLE_CAPS: PresenceRoleCaps = Object.freeze({
  pointer: true,
  selection: true,
  drag: true,
  resize: true,
  marquee: true,
});

const VIEW_ROLE_CAPS: PresenceRoleCaps = Object.freeze({
  pointer: true,
  selection: true,
  drag: false,
  resize: false,
  marquee: false,
});

export function presenceRoleCaps(role: PresenceRole): PresenceRoleCaps {
  return role === "viewer" ? VIEW_ROLE_CAPS : EDIT_ROLE_CAPS;
}
