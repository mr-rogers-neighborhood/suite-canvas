import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
import { create } from "zustand";
import { useCanvasStore } from "../store/useCanvasStore";
import { getOrCreateIdentity, type Identity } from "./identity";
import {
  AWARENESS_FIELDS,
  type ConnectorState,
  type DraggingState,
  type FocusState,
  type PeerPresence,
  type PointerState,
  type PresenceUser,
  type SelectionState,
} from "./presence";

interface PresenceState {
  localUser: Identity;
  awareness: Awareness | null;
  peers: Record<number, PeerPresence>;
  bind: (provider: HocuspocusProvider) => void;
  setPointer: (pointer: PointerState | null) => void;
  setFocus: (focus: FocusState | null) => void;
  setDragging: (dragging: DraggingState | null) => void;
  setSelection: (selection: SelectionState | null) => void;
  setMovingConnector: (connector: ConnectorState | null) => void;
}

function toPresenceUser(state: Record<string, unknown>): PresenceUser {
  const user = state[AWARENESS_FIELDS.user] as Partial<PresenceUser> | undefined;
  return {
    name: user?.name ?? "Anonymous",
    color: user?.color ?? "#94a3b8",
  };
}

function toPeerPresence(clientId: number, state: Record<string, unknown>): PeerPresence {
  return {
    clientId,
    user: toPresenceUser(state),
    pointer: (state[AWARENESS_FIELDS.pointer] as PointerState | undefined) ?? null,
    focus: (state[AWARENESS_FIELDS.focus] as FocusState | undefined) ?? null,
    dragging: (state[AWARENESS_FIELDS.dragging] as DraggingState | undefined) ?? null,
    selection: (state[AWARENESS_FIELDS.selection] as SelectionState | undefined) ?? null,
    connector: (state[AWARENESS_FIELDS.connector] as ConnectorState | undefined) ?? null,
  };
}

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
        const peers: Record<number, PeerPresence> = {};
        for (const [clientId, state] of states) {
          if (clientId === awareness.clientID) continue;
          peers[clientId] = toPeerPresence(clientId, state);
        }
        set({ peers });
      };

      awareness.on("change", sync);
      set({ awareness });
      sync();
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
  };
});
