import { WorkspaceDocument } from "@suite/graph";
import { EphemeralStore, LoroDoc } from "loro-crdt";
import { CursorEphemeralStore } from "loro-prosemirror";
import { create } from "zustand";
import { TAB_ID } from "../collab/tabId";
import { markBoot, measureBoot } from "../dev/bootTiming";
import { hostKind } from "../host/bridge";
import { getSession } from "../session/session";
import { createWorkspacePersistence } from "../storage/workspacePersistence";

/**
 * What the indicator can say. The words are the ones the title bar already uses;
 * a status of `unauthorized` can no longer happen, and stays because surfaces
 * branch on it.
 */
export type ConnectionStatus =
  | "connected"
  | "connecting"
  | "rejoining"
  | "disconnected"
  | "unauthorized";

function searchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** A workspace owns its boards and cards. `?doc=` remains a legacy alias. */
export function resolveWorkspaceId(): string | null {
  return searchParam("workspace") ?? searchParam("doc");
}

export function resolveBoardId(): string | null {
  return searchParam("board");
}

/**
 * The document this tab edits: the workspace room, or the projection room of a
 * share link. Both come from the session so a share never reads the owner's id.
 */
const SESSION = getSession();
export const WORKSPACE_ID = SESSION.workspaceId;
const ROOM_ID = SESSION.roomId;

const doc = new LoroDoc();
const workspace = new WorkspaceDocument(doc);
const presence = new EphemeralStore(30_000);
const cursors = new CursorEphemeralStore(TAB_ID, 30_000);

// Keyed by room, not workspace: a viewer of a board projection must not load
// whatever this browser cached for the owner's workspace. The host decides which
// adapter backs the local copy; nothing here knows whether it is IndexedDB or a
// file owned by the main process.
const persistence = createWorkspacePersistence({
  host: hostKind(),
  roomId: ROOM_ID,
  doc,
  indexedDb: typeof indexedDB !== "undefined",
});

markBoot("store:created");

interface CanvasState {
  workspace: WorkspaceDocument;
  presence: EphemeralStore;
  cursors: CursorEphemeralStore;
  /**
   * Null until the transport exists.
   *
   * The sync client runs in the main process, because the key schedule does, so the
   * renderer will hand it a document update rather than open a socket itself.
   */
  provider: null;
  status: ConnectionStatus;
  /** True once local storage has hydrated. */
  ready: boolean;
  /** True once there is nothing left to wait for before the board can paint. */
  synced: boolean;
  /** True when a transport is configured. Always false until there is one. */
  syncEnabled: boolean;
  connect: () => void;
  /**
   * Persist locally and wait until the room has the latest local version.
   * Publishes call this so the server never reads a draft the transport has
   * not received yet.
   */
  flush: () => Promise<void>;
  /** Rejoin the host. A no-op until the transport exists. */
  rejoin: () => void;
  /**
   * Stops writing this document to this browser. Used by “Forget this browser”:
   * without it, the pagehide flush would recreate the copy just deleted.
   */
  forgetLocal: () => void;
}

export const useCanvasStore = create<CanvasState>((set) => {
  // A launch syncs with nothing. The transport lives in the main process, because
  // the key schedule does, so there is no provider to construct here yet.

  if (persistence) {
    markBoot("hydrate:start");
    void persistence
      .load()
      .catch((error) => console.warn("[loro] local hydration failed", error))
      .finally(() => {
        markBoot("hydrate:end");
        measureBoot("hydrate", "hydrate:start", "hydrate:end");
        set({ ready: true });
      });
  } else {
    markBoot("hydrate:end");
  }

  const flush = () => {
    void persistence?.flush();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    workspace,
    presence,
    cursors,
    provider: null,
    status: "disconnected",
    ready: persistence === null,
    synced: true,
    syncEnabled: false,
    connect: () => {},
    flush: async () => {
      await persistence?.flush();
    },
    rejoin: () => {},
    forgetLocal: () => {
      persistence?.destroy();
    },
  };
});
