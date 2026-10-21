import { useEffect } from "react";
import { CanvasBoard } from "./canvas/CanvasBoard";
import { usePresenceStore } from "./collab/usePresenceStore";
import { useGraphSnapshot } from "./hooks/useGraphSnapshot";
import { useCanvasStore } from "./store/useCanvasStore";
import { useUiStore } from "./store/useUiStore";

export default function App() {
  const graph = useCanvasStore((state) => state.graph);
  const connect = useCanvasStore((state) => state.connect);
  const provider = useCanvasStore((state) => state.provider);
  const status = useCanvasStore((state) => state.status);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const setFocus = usePresenceStore((state) => state.setFocus);
  useGraphSnapshot();

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
    <div className="h-screen w-screen bg-gray-50">
      <CanvasBoard />
      <div className="pointer-events-none fixed bottom-2 left-2 z-40 rounded bg-white/80 px-2 py-1 text-xs text-gray-400">
        sync: {status}
      </div>
    </div>
  );
}
