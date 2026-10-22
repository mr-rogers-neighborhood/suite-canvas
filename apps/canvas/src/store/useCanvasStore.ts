import { WorkspaceDocument } from "@suite/graph";
import { EphemeralStore, LoroDoc } from "loro-crdt";
import { CursorEphemeralStore } from "loro-prosemirror";
import { create } from "zustand";
import { LoroIndexeddbPersistence } from "../collab/loroPersistence";
import { type LoroConnectionStatus, LoroProvider } from "../collab/loroProvider";
import { TAB_ID } from "../collab/tabId";

export type ConnectionStatus = LoroConnectionStatus;

function searchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** A workspace owns its boards and cards. `?doc=` remains a legacy alias. */
export function resolveWorkspaceId(): string {
  return searchParam("workspace") ?? searchParam("doc") ?? "default-workspace";
}

export function resolveBoardId(): string | null {
  return searchParam("board");
}

export const WORKSPACE_ID = resolveWorkspaceId();

const doc = new LoroDoc();
const workspace = new WorkspaceDocument(doc);
const presence = new EphemeralStore(30_000);
const cursors = new CursorEphemeralStore(TAB_ID, 30_000);

const persistence =
  typeof indexedDB !== "undefined" ? new LoroIndexeddbPersistence(WORKSPACE_ID, doc) : null;

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
}

/** Unit tests mount components without a sync server; a socket there only adds noise. */
const TEST_MODE = import.meta.env.MODE === "test";

export const useCanvasStore = create<CanvasState>((set) => {
  const provider =
    typeof window === "undefined" || TEST_MODE
      ? null
      : new LoroProvider({
          url: import.meta.env.VITE_COLLAB_URL ?? "ws://localhost:1234",
          workspaceId: WORKSPACE_ID,
          doc,
          presence,
          cursors,
          onStatus: (status) => set({ status }),
          onSynced: () => set({ synced: true }),
        });

  if (persistence) {
    void persistence
      .load()
      .catch((error) => console.warn("[loro] local hydration failed", error))
      .finally(() => set({ ready: true }));
  }

  if (provider) {
    setTimeout(() => {
      if (!useCanvasStore.getState().synced) set({ synced: true });
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
  };
});
