import { WorkspaceDocument } from "@suite/graph";
import { EphemeralStore, LoroDoc } from "loro-crdt";
import { CursorEphemeralStore } from "loro-prosemirror";
import { create } from "zustand";
import { TAB_ID } from "../collab/tabId";
import { markBoot, measureBoot } from "../dev/bootTiming";
import { hostKind } from "../host/bridge";
import { getSession } from "../session/session";
import { createWorkspacePersistence } from "../storage/workspacePersistence";
import { readSuiteSyncConfig } from "../sync/config";
import { SuiteSyncProvider } from "../sync/suiteSyncProvider";

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

/** How long to wait for the first server sync before treating the doc as local. */
const SYNC_WAIT_MS = 5000;

type CanvasProvider = SuiteSyncProvider;

interface CanvasState {
  workspace: WorkspaceDocument;
  presence: EphemeralStore;
  cursors: CursorEphemeralStore;
  provider: CanvasProvider | null;
  status: ConnectionStatus;
  /** True once local storage has hydrated. */
  ready: boolean;
  /** True once the first server sync landed (or the wait ran out). */
  synced: boolean;
  /** True when a dev `suite-sync` transport is configured. */
  syncEnabled: boolean;
  connect: () => void;
  /**
   * Persist locally and wait until the room has the latest local version.
   * Publishes call this so the server never reads a draft the transport has
   * not received yet.
   */
  flush: () => Promise<void>;
  /**
   * Rejoin the relay room with this browser's local document. The claim retry
   * calls it when a workspace becomes claimable after boot; the provider also
   * calls its own `rejoin` when the connection returns. A no-op without a
   * relay, or while the room is live.
   */
  rejoin: () => void;
  /**
   * Stops writing this document to this browser. Used by “Forget this browser”:
   * without it, the pagehide flush would recreate the copy just deleted.
   */
  forgetLocal: () => void;
}

/**
 * A socket is pointless without a relay: unit tests mount components with no
 * server, and the standalone profile is a static build with no relay at all.
 * A `suite-sync` query is the exception: it is the dev transport, and it is
 * chosen before either provider is constructed at module load.
 */
const SYNC_READ = readSuiteSyncConfig(WORKSPACE_ID);
const SYNC_CONFIG = SYNC_READ?.ok ? SYNC_READ.value : null;
if (SYNC_READ !== null && !SYNC_READ.ok) {
  console.warn(`[suite-sync] ${SYNC_READ.error}`);
}

export const useCanvasStore = create<CanvasState>((set) => {
  const onSynced = () => {
    markBoot("sync:end");
    measureBoot("to-synced", "store:created", "sync:end");
    set({ synced: true });
  };

  // The only transport left is the dev `suite-sync` one, chosen by a query
  // parameter. A normal launch syncs with nothing, which is the product.
  const provider: CanvasProvider | null =
    SYNC_CONFIG !== null && import.meta.env.MODE !== "test"
      ? new SuiteSyncProvider({
          ...SYNC_CONFIG,
          doc,
          onStatus: (status) => set({ status }),
          onSynced,
        })
      : null;

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

  if (provider) {
    setTimeout(() => {
      if (!useCanvasStore.getState().synced) {
        markBoot("sync:end");
        measureBoot("to-synced", "store:created", "sync:end");
        set({ synced: true });
      }
    }, SYNC_WAIT_MS);
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
    provider,
    status: provider ? provider.status : "connecting",
    ready: persistence === null,
    synced: provider === null,
    syncEnabled: SYNC_CONFIG !== null,
    connect: () => {
      void provider?.connect();
    },
    flush: async () => {
      await Promise.all([persistence?.flush(), provider?.flush()]);
    },
    rejoin: () => {
      void provider?.rejoin();
    },
    forgetLocal: () => {
      persistence?.destroy();
    },
  };
});
