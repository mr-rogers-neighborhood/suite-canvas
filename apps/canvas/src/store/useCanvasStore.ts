import { WorkspaceDocument } from "@suite/graph";
import { EphemeralStore, LoroDoc } from "loro-crdt";
import { CursorEphemeralStore } from "loro-prosemirror";
import { create } from "zustand";
import { LoroIndexeddbPersistence } from "../collab/loroPersistence";
import { type LoroConnectionStatus, LoroProvider, type ProviderAuth } from "../collab/loroProvider";
import { TAB_ID } from "../collab/tabId";
import { markBoot, measureBoot } from "../dev/bootTiming";
import { collabWsUrl } from "../session/endpoints";
import { isStandalone } from "../session/mode";
import { getSession } from "../session/session";

export type ConnectionStatus = LoroConnectionStatus;

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
// whatever this browser cached for the owner's workspace.
const persistence =
  ROOM_ID && typeof indexedDB !== "undefined" ? new LoroIndexeddbPersistence(ROOM_ID, doc) : null;

markBoot("store:created");

/**
 * A share token is the only credential a share room accepts, and it is constant.
 * A normal editor session presents the account's session JWT (ADR-0074), which
 * lives five minutes — so the provider is handed a mint rather than the token,
 * and asks for a fresh one at every room join.
 */
const auth: ProviderAuth | undefined = SESSION.share
  ? new TextEncoder().encode(SESSION.share.token)
  : SESSION.credential === "account" && import.meta.env.VITE_SUITE_MODE !== "standalone"
    ? async () => {
        // On demand, so the token client is not in the boot chunk of a build
        // that never joins a room. The literal lets a standalone bundle drop it.
        const { relayCredentialBytes } = await import("../auth/credential");
        return relayCredentialBytes();
      }
    : undefined;

/** How long to wait for the first server sync before treating the doc as local. */
const SYNC_WAIT_MS = 5000;

interface CanvasState {
  workspace: WorkspaceDocument;
  presence: EphemeralStore;
  cursors: CursorEphemeralStore;
  provider: LoroProvider | null;
  status: ConnectionStatus;
  /** True once local storage has hydrated. */
  ready: boolean;
  /** True once the first server sync landed (or the wait ran out). */
  synced: boolean;
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
 * `LoroProvider` opens its socket in the constructor, so this has to be decided
 * before the provider is constructed at module load.
 */
const NO_TRANSPORT = import.meta.env.MODE === "test" || isStandalone();

export const useCanvasStore = create<CanvasState>((set) => {
  const provider =
    !ROOM_ID || typeof window === "undefined" || NO_TRANSPORT
      ? null
      : new LoroProvider({
          url: collabWsUrl(),
          workspaceId: ROOM_ID,
          doc,
          presence,
          cursors,
          ...(auth ? { auth } : {}),
          onStatus: (status) => set({ status }),
          onSynced: () => {
            markBoot("sync:end");
            measureBoot("to-synced", "store:created", "sync:end");
            set({ synced: true });
          },
        });

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
