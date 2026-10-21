import type { GraphNode } from "@suite/graph";
import { useEffect } from "react";
import { CanvasBoard } from "./canvas/CanvasBoard";
import { CollaborativeEditor } from "./editor/CollaborativeEditor";
import { useGraphSnapshot } from "./hooks/useGraphSnapshot";
import { useCanvasStore } from "./store/useCanvasStore";

const now = Date.now();

const seedNodes: GraphNode[] = [
  {
    id: "welcome-note",
    kind: "note",
    position: { x: 0, y: 0 },
    createdAt: now,
    updatedAt: now,
    data: { text: "Welcome to Suite — a local-first collaborative canvas." },
  },
  {
    id: "getting-started",
    kind: "document",
    position: { x: 360, y: 0 },
    createdAt: now,
    updatedAt: now,
    data: { title: "Getting started", body: "Type in the note panel — it syncs collaboratively." },
  },
];

export default function App() {
  const graph = useCanvasStore((state) => state.graph);
  const connect = useCanvasStore((state) => state.connect);
  const status = useCanvasStore((state) => state.status);
  useGraphSnapshot();

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (graph.listNodes().length > 0) return;
    const timestamp = Date.now();
    for (const node of seedNodes) {
      graph.setNode({ ...node, createdAt: timestamp, updatedAt: timestamp });
    }
    graph.setEdge({
      id: "welcome-link",
      source: "welcome-note",
      target: "getting-started",
      kind: "references",
      label: "see also",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }, [graph]);

  return (
    <div className="flex h-screen w-screen bg-gray-50">
      <main className="relative min-w-0 flex-1">
        <CanvasBoard />
      </main>
      <aside className="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white p-4">
        <CollaborativeEditor doc={graph.doc} />
        <div className="mt-2 text-xs text-gray-400">sync: {status}</div>
      </aside>
    </div>
  );
}
