import type { EphemeralStore, Value } from "loro-crdt";
import { create } from "zustand";
import type { CanvasMode } from "../canvas/links/linkGesture";
import type { CanvasPurpose } from "../canvas/purpose";
import { useCanvasStore } from "../store/useCanvasStore";
import { getOrCreateIdentity, type Identity } from "./identity";
import {
  PRESENCE_BEAT_MS,
  projectPeers,
  type SeenGesture,
  sanitizeDraggedNodeIds,
} from "./peerProjection";
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
  type ReconnectState,
  type ResizingState,
  type SectionDragState,
  type SectionResizeState,
  type SelectionBoxState,
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
  setSelectionBox: (box: SelectionBoxState | null) => void;
  setMovingConnector: (connector: ConnectorState | null) => void;
  setResizing: (resizing: ResizingState | null) => void;
  setSectionDrag: (section: SectionDragState | null) => void;
  setSectionResize: (section: SectionResizeState | null) => void;
  setReconnect: (reconnect: ReconnectState | null) => void;
  setConnect: (connect: ConnectState | null) => void;
  setLabelDrag: (labelDrag: LabelDragState | null) => void;
  /** A card held in the library, in flow units, so peers see where it lands. */
  setLibraryDrag: (libraryDrag: LibraryDragState | null) => void;
  /** The purpose axis, so a peer's cursor can say "recording a tour" (ADR-0064). */
  setPurpose: (purpose: CanvasPurpose | null) => void;
  /** The gesture axis, so a peer's cursor can say what their next click does. */
  setGesture: (gesture: CanvasMode | null) => void;
}

/**
 * How often a held gesture re-announces itself. Well inside `GESTURE_TTL_MS`
 * (3s), so a stationary hold never looks like a dropped peer.
 */
const GESTURE_BEAT_MS = 1000;

/** Last gesture signature and arrival time per peer, for the staleness check. */
const gestureClock = new Map<string, SeenGesture>();

/** Last heartbeat marker and arrival time per peer, for the liveness check. */
const heartbeatClock = new Map<string, { marker: string; at: number }>();

export const usePresenceStore = create<PresenceState>((set, get) => {
  const initial = useCanvasStore.getState();
  let localState: Record<string, Value> = {
    [AWARENESS_FIELDS.user]: getOrCreateIdentity() as unknown as Value,
    [AWARENESS_FIELDS.presenceBeat]: 0,
  };
  let heartbeat = 0;

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
    AWARENESS_FIELDS.selectionBox,
    AWARENESS_FIELDS.labelDrag,
  ] as const;

  const hasLocalInteraction = () =>
    interactionFields.some(
      (field) => localState[field] !== undefined && localState[field] !== null,
    );

  /**
   * A gesture is refreshed only when its payload changes, so a peer who presses
   * and holds without moving would drop out of everyone's view after the TTL.
   * While a local gesture is live, bump a counter once a second: cheap, and it is
   * the difference between "still holding" and "gone".
   */
  let beatTimer: number | null = null;
  let beat = 0;
  const beatNow = () => {
    beat += 1;
    publish(AWARENESS_FIELDS.gestureBeat, beat);
  };
  const keepAlive = () => {
    if (beatTimer !== null) return;
    beatTimer = window.setInterval(beatNow, GESTURE_BEAT_MS);
  };
  const stopKeepAlive = () => {
    if (beatTimer === null) return;
    window.clearInterval(beatTimer);
    beatTimer = null;
  };

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
      peers: projectPeers(states, {
        selfId: peerId,
        now: performance.now(),
        seen: gestureClock,
        heard: heartbeatClock,
      }),
    });
  };

  const publishGesture = (field: string, value: unknown) => {
    publish(field, value);
    if (value === null || value === undefined) {
      if (!hasLocalInteraction()) stopKeepAlive();
      return;
    }
    keepAlive();
    beatNow();
  };

  /**
   * Stops the previous binding's subscription and poll. A reconnect hands over a
   * new `EphemeralStore`, and a leaked pair would keep publishing into a store
   * nobody reads and rewriting the peer list twice a second.
   */
  let stopBinding: (() => void) | null = null;

  return {
    localUser: getOrCreateIdentity(),
    presenceStore: initial.presence ?? null,
    peerId: TAB_ID,
    bound: false,
    peers: {},

    bind: (store, peerId) => {
      const current = get();
      if (current.bound && current.presenceStore === store && current.peerId === peerId) return;
      stopBinding?.();
      store.set(peerId, localState);
      const unsubscribe = store.subscribe(sync);
      const timer = setInterval(sync, 1000);
      // The client's own liveness, on a timer rather than on activity.
      //
      // The relay never announces a leave, so the reader's side has to expire a peer, and
      // expiring on silence would also remove someone who is connected and reading. A beat
      // is what makes silence mean something: without it, a peer who sits still for the
      // ephemeral timeout looks exactly like a peer who closed the tab.
      const beatTimer = setInterval(() => {
        heartbeat += 1;
        publish(AWARENESS_FIELDS.presenceBeat, heartbeat);
      }, PRESENCE_BEAT_MS);
      const handleUnload = () => {
        const { presenceStore: s, peerId: p } = get();
        if (s && p) {
          try {
            s.delete(p);
          } catch {
            // Ignore errors during page unload
          }
        }
      };

      if (typeof window !== "undefined") {
        window.addEventListener("beforeunload", handleUnload);
        window.addEventListener("pagehide", handleUnload);
      }

      stopBinding = () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("beforeunload", handleUnload);
          window.removeEventListener("pagehide", handleUnload);
        }
        unsubscribe();
        window.clearInterval(timer);
        window.clearInterval(beatTimer);
      };
      set({ presenceStore: store, peerId, bound: true });
      sync();
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
      if (dragging) {
        const nodeIds = sanitizeDraggedNodeIds(dragging.nodeIds, dragging.nodeId);
        publish(AWARENESS_FIELDS.dragging, {
          nodeId: dragging.nodeId,
          position: dragging.position,
          // A single-card drag keeps the original payload; the set is only
          // carried when more than the anchor moves.
          ...(nodeIds.length > 1 ? { nodeIds } : {}),
        });
        clearPointer();
        return;
      }
      publish(AWARENESS_FIELDS.dragging, null);
    },
    setSelection: (selection) => publish(AWARENESS_FIELDS.selection, selection),
    setSelectionBox: (box) => {
      publish(AWARENESS_FIELDS.selectionBox, box);
      // The marquee is a gesture: the arrow would only clutter the box.
      if (box) clearPointer();
    },
    setMovingConnector: (connector) => {
      publishGesture(AWARENESS_FIELDS.connector, connector);
      if (connector) clearPointer();
    },
    setResizing: (resizing) => {
      publishGesture(AWARENESS_FIELDS.resizing, resizing);
      if (resizing) clearPointer();
    },
    setSectionDrag: (sectionDrag) => {
      publishGesture(AWARENESS_FIELDS.sectionDrag, sectionDrag);
      if (sectionDrag) clearPointer();
    },
    setSectionResize: (sectionResize) => {
      publishGesture(AWARENESS_FIELDS.sectionResize, sectionResize);
      if (sectionResize) clearPointer();
    },
    setReconnect: (reconnect) => {
      publishGesture(AWARENESS_FIELDS.reconnect, reconnect);
      if (reconnect) clearPointer();
    },
    setConnect: (connect) => {
      publishGesture(AWARENESS_FIELDS.connect, connect);
      if (connect) clearPointer();
    },
    setLabelDrag: (labelDrag) => {
      publishGesture(AWARENESS_FIELDS.labelDrag, labelDrag);
      if (labelDrag) clearPointer();
    },
    setLibraryDrag: (libraryDrag) => {
      publishGesture(AWARENESS_FIELDS.libraryDrag, libraryDrag);
      if (libraryDrag) clearPointer();
    },
    // The two axes are *state*, not gestures: an in-flight payload that needs
    // refreshing, but a standing fact about what the reader is doing. They ride
    // the ordinary publish so a mode click does not start a keep-alive.
    setPurpose: (purpose) => publish(AWARENESS_FIELDS.purpose, purpose),
    setGesture: (gesture) => publish(AWARENESS_FIELDS.gesture, gesture),
  };
});

export type { PeerPresence };
