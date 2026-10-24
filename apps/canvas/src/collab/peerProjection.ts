import {
  AWARENESS_FIELDS,
  type ConnectorState,
  type ConnectState,
  type DraggingState,
  type FocusState,
  type LabelDragState,
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

/** A peer's Board attribution: a non-empty id, or null for "on the plane". */
function boardIdOf(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value;
}

export function toPeerPresence(clientId: string, state: Record<string, unknown>): PeerPresence {
  return {
    clientId,
    board: (state[AWARENESS_FIELDS.board] as string | undefined) ?? null,
    boardOf: boardIdOf(state[AWARENESS_FIELDS.boardOf]),
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
  };
}

/** Only the in-flight gestures: selections and carets are state, not gestures. */
export function gestureSignature(peer: PeerPresence): string {
  if (
    !peer.dragging &&
    !peer.connector &&
    !peer.resizing &&
    !peer.sectionDrag &&
    !peer.sectionResize &&
    !peer.reconnect &&
    !peer.connect &&
    !peer.labelDrag &&
    !peer.selectionBox
  ) {
    return "";
  }
  return JSON.stringify([
    peer.dragging,
    peer.connector,
    peer.resizing,
    peer.sectionDrag,
    peer.sectionResize,
    peer.reconnect,
    peer.connect,
    peer.labelDrag,
    peer.selectionBox,
  ]);
}

function withoutGesture(peer: PeerPresence): PeerPresence {
  if (
    !peer.dragging &&
    !peer.connector &&
    !peer.resizing &&
    !peer.sectionDrag &&
    !peer.sectionResize &&
    !peer.reconnect &&
    !peer.connect &&
    !peer.labelDrag &&
    !peer.selectionBox
  ) {
    return peer;
  }
  return {
    ...peer,
    dragging: null,
    connector: null,
    resizing: null,
    sectionDrag: null,
    sectionResize: null,
    reconnect: null,
    connect: null,
    labelDrag: null,
    selectionBox: null,
  };
}

/**
 * Projects awareness states into peer presence, dropping gestures that stopped
 * arriving. `seen` carries the last signature and arrival time per client and is
 * mutated in place.
 */
export function projectPeers(
  states: Map<string, Record<string, unknown>>,
  context: { selfId: string | null; now: number; seen: Map<string, SeenGesture> },
): Record<string, PeerPresence> {
  const peers: Record<string, PeerPresence> = {};
  const live = new Set<string>();

  for (const [clientId, state] of states) {
    if (clientId === context.selfId) continue;
    live.add(clientId);

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

  return peers;
}
