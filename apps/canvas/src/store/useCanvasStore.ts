import { HocuspocusProvider } from "@hocuspocus/provider";
import { GraphDocument } from "@suite/graph";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { create } from "zustand";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

function resolveDocId(): string {
  if (typeof window !== "undefined") {
    const requested = new URLSearchParams(window.location.search).get("doc");
    if (requested) return requested;
  }
  return "default-graph";
}

export const DOC_ID = resolveDocId();

const doc = new Y.Doc();
const graph = new GraphDocument(doc);

// Offline-first: persist the document locally in IndexedDB so the app works
// with no network and rehydrates instantly on reload.
if (typeof indexedDB !== "undefined") {
  new IndexeddbPersistence(DOC_ID, doc);
}

interface CanvasState {
  graph: GraphDocument;
  provider: HocuspocusProvider | null;
  status: ConnectionStatus;
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
          name: DOC_ID,
          document: doc,
        });

  provider?.on("status", (event: { status: string }) => {
    set({ status: event.status as ConnectionStatus });
  });

  return {
    graph,
    provider,
    status: provider ? "disconnected" : "connecting",
    connect: () => {
      void provider?.connect();
    },
  };
});
