import {
  AWARENESS_FIELDS,
  type ConnectorState,
  type DraggingState,
  type FocusState,
  type PeerPresence,
  type PointerState,
  type PresenceUser,
  type ReconnectState,
  type ResizingState,
  type SelectionState,
} from "./presence";

/**
 * A gesture that stops arriving without an explicit end (tab closed, network
 * dropped, renderer killed) would otherwise leave a ghost card or link on every
 * peer until awareness times the client out. Peers refresh active gestures at
 * ~25 Hz, so a few seconds of silence is conclusive.
 */
export const GESTURE_TTL_MS = 3000;

export interface SeenGesture {
  signature: string;
  at: number;
}

function toPresenceUser(state: Record<string, unknown>): PresenceUser {
  const user = state[AWARENESS_FIELDS.user] as Partial<PresenceUser> | undefined;
  return {
    name: user?.name ?? "Anonymous",
    color: user?.color ?? "#94a3b8",
  };
}

export function toPeerPresence(clientId: number, state: Record<string, unknown>): PeerPresence {
  return {
    clientId,
    board: (state[AWARENESS_FIELDS.board] as string | undefined) ?? null,
    user: toPresenceUser(state),
    pointer: (state[AWARENESS_FIELDS.pointer] as PointerState | undefined) ?? null,
    focus: (state[AWARENESS_FIELDS.focus] as FocusState | undefined) ?? null,
    dragging: (state[AWARENESS_FIELDS.dragging] as DraggingState | undefined) ?? null,
    selection: (state[AWARENESS_FIELDS.selection] as SelectionState | undefined) ?? null,
    connector: (state[AWARENESS_FIELDS.connector] as ConnectorState | undefined) ?? null,
    resizing: (state[AWARENESS_FIELDS.resizing] as ResizingState | undefined) ?? null,
    reconnect: (state[AWARENESS_FIELDS.reconnect] as ReconnectState | undefined) ?? null,
  };
}

/** Only the in-flight gestures: selections and carets are state, not gestures. */
export function gestureSignature(peer: PeerPresence): string {
  if (!peer.dragging && !peer.connector && !peer.resizing && !peer.reconnect) return "";
  return JSON.stringify([peer.dragging, peer.connector, peer.resizing, peer.reconnect]);
}

function withoutGesture(peer: PeerPresence): PeerPresence {
  if (!peer.dragging && !peer.connector && !peer.resizing && !peer.reconnect) return peer;
  return { ...peer, dragging: null, connector: null, resizing: null, reconnect: null };
}

/**
 * Projects awareness states into peer presence, dropping gestures that stopped
 * arriving. `seen` carries the last signature and arrival time per client and is
 * mutated in place.
 */
export function projectPeers(
  states: Map<number, Record<string, unknown>>,
  context: { selfId: number | null; now: number; seen: Map<number, SeenGesture> },
): Record<number, PeerPresence> {
  const peers: Record<number, PeerPresence> = {};
  const live = new Set<number>();

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
