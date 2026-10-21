import { HocuspocusProvider } from "@hocuspocus/provider";
import { WorkspaceDocument } from "@suite/graph";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { create } from "zustand";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

function searchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/**
 * A workspace owns its boards and cards. `?doc=` is accepted as a legacy alias so
 * older links and tests keep resolving to the same document.
 */
export function resolveWorkspaceId(): string {
  return searchParam("workspace") ?? searchParam("doc") ?? "default-workspace";
}

export function resolveBoardId(): string | null {
  return searchParam("board");
}

export const WORKSPACE_ID = resolveWorkspaceId();

const doc = new Y.Doc();
const workspace = new WorkspaceDocument(doc);

// Offline-first: persist the document locally in IndexedDB so the app works
// with no network and rehydrates instantly on reload.
const persistence =
  typeof indexedDB !== "undefined" ? new IndexeddbPersistence(WORKSPACE_ID, doc) : null;

/** How long to wait for the first server sync before treating the doc as local. */
const SYNC_WAIT_MS = 5000;

interface CanvasState {
  workspace: WorkspaceDocument;
  provider: HocuspocusProvider | null;
  status: ConnectionStatus;
  /** True once local storage has hydrated, so startup work never races loading. */
  ready: boolean;
  /**
   * True once the first server sync landed (or the wait ran out). Startup writes
   * — migration and seeding — wait for it: a client that hydrates an empty
   * IndexedDB before the server's snapshot arrives would otherwise seed starter
   * cards over a workspace whose cards were deliberately deleted.
   */
  synced: boolean;
  connect: () => void;
}

export const useCanvasStore = create<CanvasState>((set) => {
  // Created eagerly so `provider.awareness` exists on the first render. Editors
  // bind to that awareness; creating it later would remount them and drop
  // in-flight keystrokes.
  const provider =
    typeof window === "undefined"
      ? null
      : new HocuspocusProvider({
          url: import.meta.env.VITE_COLLAB_URL ?? "ws://localhost:1234",
          name: WORKSPACE_ID,
          document: doc,
        });

  provider?.on("status", (event: { status: string }) => {
    set({ status: event.status as ConnectionStatus });
  });

  provider?.on("synced", () => set({ synced: true }));

  persistence?.on("synced", () => set({ ready: true }));

  // Offline first run: nothing will ever sync, so local state is authoritative.
  if (provider) {
    setTimeout(() => {
      if (!useCanvasStore.getState().synced) set({ synced: true });
    }, SYNC_WAIT_MS);
  }

  return {
    workspace,
    provider,
    status: provider ? "disconnected" : "connecting",
    ready: persistence === null,
    synced: provider === null,
    connect: () => {
      void provider?.connect();
    },
  };
});
