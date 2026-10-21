import type { EphemeralStore, Value } from "loro-crdt";
import { create } from "zustand";
import { useCanvasStore } from "../store/useCanvasStore";
import { getOrCreateIdentity, type Identity } from "./identity";
import { projectPeers, type SeenGesture } from "./peerProjection";
import {
  AWARENESS_FIELDS,
  type ConnectorState,
  type ConnectState,
  type DraggingState,
  type FocusState,
  type PeerPresence,
  type PointerState,
  type ReconnectState,
  type ResizingState,
  type SectionDragState,
  type SectionResizeState,
  type SelectionState,
} from "./presence";
import { TAB_ID } from "./tabId";

interface PresenceState {
  localUser: Identity;
  presenceStore: EphemeralStore | null;
  peerId: string | null;
  bound: boolean;
  peers: Record<string, PeerPresence>;
  bind: (store: EphemeralStore, peerId: string) => void;
  setBoard: (boardId: string | null) => void;
  setPointer: (pointer: PointerState | null) => void;
  setFocus: (focus: FocusState | null) => void;
  setDragging: (dragging: DraggingState | null) => void;
  setSelection: (selection: SelectionState | null) => void;
  setMovingConnector: (connector: ConnectorState | null) => void;
  setResizing: (resizing: ResizingState | null) => void;
  setSectionDrag: (section: SectionDragState | null) => void;
  setSectionResize: (section: SectionResizeState | null) => void;
  setReconnect: (reconnect: ReconnectState | null) => void;
  setConnect: (connect: ConnectState | null) => void;
}

/** Last gesture signature and arrival time per peer, for the staleness check. */
const gestureClock = new Map<string, SeenGesture>();

export const usePresenceStore = create<PresenceState>((set, get) => {
  const initial = useCanvasStore.getState();
  let localState: Record<string, Value> = {
    [AWARENESS_FIELDS.user]: getOrCreateIdentity() as unknown as Value,
  };

  const publish = (field: string, value: unknown) => {
    localState = { ...localState, [field]: value as Value };
    const { presenceStore, peerId } = get();
    if (presenceStore && peerId) presenceStore.set(peerId, localState);
  };

  const interactionFields = [
    AWARENESS_FIELDS.focus,
    AWARENESS_FIELDS.dragging,
    AWARENESS_FIELDS.connector,
    AWARENESS_FIELDS.resizing,
    AWARENESS_FIELDS.sectionDrag,
    AWARENESS_FIELDS.sectionResize,
    AWARENESS_FIELDS.reconnect,
    AWARENESS_FIELDS.connect,
  ] as const;

  const hasLocalInteraction = () =>
    interactionFields.some(
      (field) => localState[field] !== undefined && localState[field] !== null,
    );

  const clearPointer = () => {
    if (
      localState[AWARENESS_FIELDS.pointer] !== undefined &&
      localState[AWARENESS_FIELDS.pointer] !== null
    ) {
      publish(AWARENESS_FIELDS.pointer, null);
    }
  };

  const sync = () => {
    const { presenceStore, peerId } = get();
    if (!presenceStore || !peerId) return;
    const states = new Map<string, Record<string, unknown>>(
      Object.entries(presenceStore.getAllStates() as Record<string, Record<string, unknown>>),
    );
    set({
      peers: projectPeers(states, { selfId: peerId, now: performance.now(), seen: gestureClock }),
    });
  };

  return {
    localUser: getOrCreateIdentity(),
    presenceStore: initial.presence ?? null,
    peerId: TAB_ID,
    bound: false,
    peers: {},

    bind: (store, peerId) => {
      const current = get();
      if (current.bound && current.presenceStore === store && current.peerId === peerId) return;
      store.set(peerId, localState);
      store.subscribe(sync);
      const timer = setInterval(sync, 1000);
      set({ presenceStore: store, peerId, bound: true });
      sync();
      // The timer is intentionally process-lifetime: the store lives as long as
      // the workspace, and Dev HMR replaces the module rather than the store.
      void timer;
    },

    setBoard: (boardId) => publish(AWARENESS_FIELDS.board, boardId),
    setPointer: (pointer) => {
      if (hasLocalInteraction()) return;
      publish(AWARENESS_FIELDS.pointer, pointer);
    },
    setFocus: (focus) => {
      publish(AWARENESS_FIELDS.focus, focus);
      if (focus) clearPointer();
    },
    setDragging: (dragging) => {
      publish(AWARENESS_FIELDS.dragging, dragging);
      if (dragging) clearPointer();
    },
    setSelection: (selection) => publish(AWARENESS_FIELDS.selection, selection),
    setMovingConnector: (connector) => {
      publish(AWARENESS_FIELDS.connector, connector);
      if (connector) clearPointer();
    },
    setResizing: (resizing) => {
      publish(AWARENESS_FIELDS.resizing, resizing);
      if (resizing) clearPointer();
    },
    setSectionDrag: (sectionDrag) => {
      publish(AWARENESS_FIELDS.sectionDrag, sectionDrag);
      if (sectionDrag) clearPointer();
    },
    setSectionResize: (sectionResize) => {
      publish(AWARENESS_FIELDS.sectionResize, sectionResize);
      if (sectionResize) clearPointer();
    },
    setReconnect: (reconnect) => {
      publish(AWARENESS_FIELDS.reconnect, reconnect);
      if (reconnect) clearPointer();
    },
    setConnect: (connect) => {
      publish(AWARENESS_FIELDS.connect, connect);
      if (connect) clearPointer();
    },
  };
});

export type { PeerPresence };
