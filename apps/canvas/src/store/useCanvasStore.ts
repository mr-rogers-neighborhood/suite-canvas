import { HocuspocusProvider } from "@hocuspocus/provider";
import { GraphDocument } from "@suite/graph";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { create } from "zustand";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export const DOC_ID = "default-graph";

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

export const useCanvasStore = create<CanvasState>((set, get) => ({
  graph,
  provider: null,
  status: "disconnected",
  connect: () => {
    if (get().provider) return;
    const provider = new HocuspocusProvider({
      url: import.meta.env.VITE_COLLAB_URL ?? "ws://localhost:1234",
      name: DOC_ID,
      document: doc,
    });
    provider.on("status", (event: { status: string }) => {
      set({ status: event.status as ConnectionStatus });
    });
    set({ provider });
  },
}));
