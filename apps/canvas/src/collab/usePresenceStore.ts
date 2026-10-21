import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
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
  type SelectionState,
} from "./presence";

interface PresenceState {
  localUser: Identity;
  awareness: Awareness | null;
  peers: Record<number, PeerPresence>;
  bind: (provider: HocuspocusProvider) => void;
  setBoard: (boardId: string | null) => void;
  setPointer: (pointer: PointerState | null) => void;
  setFocus: (focus: FocusState | null) => void;
  setDragging: (dragging: DraggingState | null) => void;
  setSelection: (selection: SelectionState | null) => void;
  setMovingConnector: (connector: ConnectorState | null) => void;
  setResizing: (resizing: ResizingState | null) => void;
  setReconnect: (reconnect: ReconnectState | null) => void;
  setConnect: (connect: ConnectState | null) => void;
}

/** Last gesture signature and arrival time per peer, for the staleness check. */
const gestureClock = new Map<number, SeenGesture>();

export const usePresenceStore = create<PresenceState>((set, get) => {
  // Bound eagerly so editor components see the real awareness on first render
  // (changing it later would remount every editor).
  const initialAwareness = useCanvasStore.getState().provider?.awareness ?? null;

  return {
    localUser: getOrCreateIdentity(),
    awareness: initialAwareness,
    peers: {},

    bind: (provider) => {
      const awareness = provider.awareness;
      if (!awareness) return;

      awareness.setLocalStateField(AWARENESS_FIELDS.user, get().localUser);

      const sync = () => {
        const states = awareness.getStates() as Map<number, Record<string, unknown>>;
        set({
          peers: projectPeers(states, {
            selfId: awareness.clientID,
            now: performance.now(),
            seen: gestureClock,
          }),
        });
      };

      // A gesture can stop without an end event, so re-project even when no
      // awareness update arrives; stale gestures then expire on their own.
      const timer = setInterval(sync, 1000);
      const stop = () => clearInterval(timer);
      awareness.on("change", sync);
      awareness.on("destroy", stop);
      set({ awareness });
      sync();
    },

    setBoard: (boardId) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.board, boardId);
    },

    setPointer: (pointer) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.pointer, pointer);
    },

    setFocus: (focus) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.focus, focus);
    },

    setDragging: (dragging) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.dragging, dragging);
    },

    setSelection: (selection) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.selection, selection);
    },

    setMovingConnector: (connector) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.connector, connector);
    },

    setResizing: (resizing) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.resizing, resizing);
    },

    setReconnect: (reconnect) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.reconnect, reconnect);
    },

    setConnect: (connect) => {
      get().awareness?.setLocalStateField(AWARENESS_FIELDS.connect, connect);
    },
  };
});

export type { PeerPresence };
