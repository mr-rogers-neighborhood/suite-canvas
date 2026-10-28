import type { CanvasMode } from "../canvas/links/linkGesture";
import type { CanvasPurpose } from "../canvas/purpose";
import {
  AWARENESS_FIELDS,
  type ConnectorState,
  type ConnectState,
  type DraggingState,
  type FocusState,
  type LabelDragState,
  type LibraryDragState,
  type PeerPresence,
  type PointerState,
  type PresenceUser,
  type ReconnectState,
  type ResizingState,
  type SectionDragState,
  type SectionResizeState,
  type SelectionBoxState,
  type SelectionState,
} from "./presence";

/**
 * A gesture that stops arriving without an explicit end (tab closed, network
 * dropped, renderer killed) would otherwise leave a ghost card or link on every
 * peer until awareness times the client out. Peers refresh active gestures at
 * ~25 Hz, so a few seconds of silence is conclusive.
 */
export const GESTURE_TTL_MS = 3000;

/**
 * How long a peer may go unheard before this page stops counting them, and how often a
 * client says it is still there.
 *
 * `loro-websocket` has no awareness protocol, so nothing tells us a peer left: their
 * ephemeral state is simply still in the store. Silence is the only available signal, and
 * silence alone would also evict a peer who is connected and reading, which is why every
 * client publishes a beat on a timer. The TTL is four beats, so one dropped message is not
 * someone disappearing, and it sits inside the background-tab timer budget browsers allow
 * (~60s) rather than outside it.
 */
export const PRESENCE_BEAT_MS = 15_000;
export const PRESENCE_TTL_MS = 60_000;

/** Guard rail: a peer cannot legitimately drag more cards than this at once. */
export const MAX_DRAG_NODE_IDS = 500;

export interface SeenGesture {
  signature: string;
  at: number;
}

/**
 * The full dragged set, anchor first. Malformed entries are dropped, the anchor
 * is always included, and the list is capped so one peer cannot flood the board.
 */
export function sanitizeDraggedNodeIds(value: unknown, anchor: string): string[] {
  const ids = [anchor];
  const seen = new Set([anchor]);
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== "string" || entry.length === 0 || seen.has(entry)) continue;
      seen.add(entry);
      ids.push(entry);
      if (ids.length >= MAX_DRAG_NODE_IDS) break;
    }
  }
  return ids;
}

function toDraggingState(value: unknown): DraggingState | null {
  if (value === null || typeof value !== "object") return null;
  const dragging = value as DraggingState;
  if (typeof dragging.nodeId !== "string" || dragging.nodeId.length === 0) return null;
  return {
    ...dragging,
    nodeIds: sanitizeDraggedNodeIds(dragging.nodeIds, dragging.nodeId),
  };
}

function toPresenceUser(state: Record<string, unknown>): PresenceUser {
  const user = state[AWARENESS_FIELDS.user] as Partial<PresenceUser> | undefined;
  return {
    name: user?.name ?? "Anonymous",
    color: user?.color ?? "#94a3b8",
  };
}

export function toPeerPresence(clientId: string, state: Record<string, unknown>): PeerPresence {
  return {
    clientId,
    board: (state[AWARENESS_FIELDS.board] as string | undefined) ?? null,
    user: toPresenceUser(state),
    pointer: (state[AWARENESS_FIELDS.pointer] as PointerState | undefined) ?? null,
    focus: (state[AWARENESS_FIELDS.focus] as FocusState | undefined) ?? null,
    dragging:
      state[AWARENESS_FIELDS.dragging] === undefined
        ? null
        : toDraggingState(state[AWARENESS_FIELDS.dragging]),
    selection: (state[AWARENESS_FIELDS.selection] as SelectionState | undefined) ?? null,
    selectionBox: (state[AWARENESS_FIELDS.selectionBox] as SelectionBoxState | undefined) ?? null,
    connector: (state[AWARENESS_FIELDS.connector] as ConnectorState | undefined) ?? null,
    resizing: (state[AWARENESS_FIELDS.resizing] as ResizingState | undefined) ?? null,
    sectionDrag: (state[AWARENESS_FIELDS.sectionDrag] as SectionDragState | undefined) ?? null,
    sectionResize:
      (state[AWARENESS_FIELDS.sectionResize] as SectionResizeState | undefined) ?? null,
    reconnect: (state[AWARENESS_FIELDS.reconnect] as ReconnectState | undefined) ?? null,
    connect: (state[AWARENESS_FIELDS.connect] as ConnectState | undefined) ?? null,
    labelDrag: (state[AWARENESS_FIELDS.labelDrag] as LabelDragState | undefined) ?? null,
    libraryDrag: (state[AWARENESS_FIELDS.libraryDrag] as LibraryDragState | undefined) ?? null,
    purpose: (state[AWARENESS_FIELDS.purpose] as CanvasPurpose | undefined) ?? null,
    gesture: (state[AWARENESS_FIELDS.gesture] as CanvasMode | undefined) ?? null,
    gestureBeat: readBeat(state[AWARENESS_FIELDS.gestureBeat]),
  };
}

function readBeat(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The in-flight gestures, in one list. The TTL check, the signature and the
 * clear-out all read it, so a new gesture field is added here once instead of in
 * three places that can drift and leave a ghost that never expires.
 */
const GESTURE_FIELDS = [
  "dragging",
  "connector",
  "resizing",
  "sectionDrag",
  "sectionResize",
  "reconnect",
  "connect",
  "labelDrag",
  "libraryDrag",
  "selectionBox",
] as const satisfies readonly (keyof PeerPresence)[];

function hasGesture(peer: PeerPresence): boolean {
  for (const field of GESTURE_FIELDS) {
    if (peer[field] !== null && peer[field] !== undefined) return true;
  }
  return false;
}

/** Only the in-flight gestures: selections and carets are state, not gestures. */
export function gestureSignature(peer: PeerPresence): string {
  if (!hasGesture(peer)) return "";
  // The beat is part of the signature on purpose: a gesture that stops arriving
  // unchanged is a peer who stopped holding it (or stopped existing), and the TTL
  // is what turns that into "the ghost is gone".
  return JSON.stringify([...GESTURE_FIELDS.map((field) => peer[field]), peer.gestureBeat ?? 0]);
}

function withoutGesture(peer: PeerPresence): PeerPresence {
  if (!hasGesture(peer)) return peer;
  const cleared: PeerPresence = { ...peer };
  for (const field of GESTURE_FIELDS) cleared[field] = null;
  return cleared;
}

/**
 * Projects awareness states into peer presence, dropping gestures that stopped
 * arriving. `seen` carries the last signature and arrival time per client and is
 * mutated in place.
 */
export function projectPeers(
  states: Map<string, Record<string, unknown>>,
  context: {
    selfId: string | null;
    now: number;
    seen: Map<string, SeenGesture>;
    /** Last heartbeat per client: the marker it sent, and when this page last heard it. */
    heard: Map<string, { marker: string; at: number }>;
  },
): Record<string, PeerPresence> {
  const peers: Record<string, PeerPresence> = {};
  const live = new Set<string>();

  for (const [clientId, state] of states) {
    if (clientId === context.selfId) continue;
    live.add(clientId);

    // The marker is the heartbeat when the peer sends one, and the whole state when they
    // do not: an older build changes state only when something happens, and treating that
    // as liveness keeps it visible rather than evicting it on a field it never heard of.
    const beat = state[AWARENESS_FIELDS.presenceBeat];
    const marker = typeof beat === "number" ? String(beat) : JSON.stringify(state);
    const previousBeat = context.heard.get(clientId);
    const heardAt = previousBeat?.marker === marker ? previousBeat.at : context.now;
    context.heard.set(clientId, { marker, at: heardAt });
    // Unheard for longer than the TTL: the client is gone, whatever its state still says.
    if (context.now - heardAt > PRESENCE_TTL_MS) continue;

    const peer = toPeerPresence(clientId, state);
    const signature = gestureSignature(peer);
    if (!signature) {
      context.seen.set(clientId, { signature, at: context.now });
      peers[clientId] = peer;
      continue;
    }

    const previous = context.seen.get(clientId);
    const receivedAt = previous && previous.signature === signature ? previous.at : context.now;
    context.seen.set(clientId, { signature, at: receivedAt });

    peers[clientId] = context.now - receivedAt > GESTURE_TTL_MS ? withoutGesture(peer) : peer;
  }

  for (const clientId of context.seen.keys()) {
    if (!live.has(clientId)) context.seen.delete(clientId);
  }
  for (const clientId of [...context.heard.keys()]) {
    if (!live.has(clientId)) context.heard.delete(clientId);
  }

  return peers;
}
