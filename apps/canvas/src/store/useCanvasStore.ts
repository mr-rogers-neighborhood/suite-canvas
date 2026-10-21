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

interface CanvasState {
  workspace: WorkspaceDocument;
  provider: HocuspocusProvider | null;
  status: ConnectionStatus;
  /** True once local storage has hydrated, so startup work never races loading. */
  ready: boolean;
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

  persistence?.on("synced", () => set({ ready: true }));

  return {
    workspace,
    provider,
    status: provider ? "disconnected" : "connecting",
    ready: persistence === null,
    connect: () => {
      void provider?.connect();
    },
  };
});
