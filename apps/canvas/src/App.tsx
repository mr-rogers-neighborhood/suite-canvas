import { useEffect } from "react";
import { CanvasBoard } from "./canvas/CanvasBoard";
import { usePresenceStore } from "./collab/usePresenceStore";
import { TitleBar } from "./components/TitleBar";
import { useGraphSnapshot } from "./hooks/useGraphSnapshot";
import { DOC_ID, useCanvasStore } from "./store/useCanvasStore";
import { useUiStore } from "./store/useUiStore";
import { initTheme } from "./theme/useThemeStore";

export default function App() {
  const graph = useCanvasStore((state) => state.graph);
  const connect = useCanvasStore((state) => state.connect);
  const provider = useCanvasStore((state) => state.provider);
  const status = useCanvasStore((state) => state.status);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const setFocus = usePresenceStore((state) => state.setFocus);
  const peerCount = usePresenceStore((state) => Object.keys(state.peers).length);
  useGraphSnapshot();

  useEffect(() => initTheme(), []);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (provider) {
      usePresenceStore.getState().bind(provider);
    }
  }, [provider]);

  useEffect(() => {
    if (graph.listNodes().length > 0) return;
    // Fixed ids so multiple fresh clients converge on the same starter notes
    // instead of each seeding duplicates.
    graph.createNote({ id: "starter-1", position: { x: 0, y: 0 } });
    graph.createNote({ id: "starter-2", position: { x: 320, y: 0 } });
  }, [graph]);

  useEffect(() => {
    setFocus(editingNodeId ? { nodeId: editingNodeId } : null);
  }, [editingNodeId, setFocus]);

  return (
    <div className="app-canvas flex h-screen w-screen flex-col">
      <TitleBar status={status} peerCount={peerCount} documentId={DOC_ID} />
      <main className="relative z-10 min-h-0 flex-1">
        <CanvasBoard />
      </main>
    </div>
  );
}
