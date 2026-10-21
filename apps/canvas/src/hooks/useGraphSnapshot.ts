import type { GraphEdge, GraphNode } from "@suite/graph";
import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";

interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * React binding for the typed graph. Subscribes to GraphDocument changes and
 * returns a fresh snapshot so components re-render on any CRDT mutation.
 */
export function useGraphSnapshot(): GraphSnapshot {
  const graph = useCanvasStore((state) => state.graph);
  const [snapshot, setSnapshot] = useState<GraphSnapshot>(() => ({
    nodes: graph.listNodes(),
    edges: graph.listEdges(),
  }));

  useEffect(() => {
    const refresh = () => {
      setSnapshot({ nodes: graph.listNodes(), edges: graph.listEdges() });
    };
    return graph.observe(refresh);
  }, [graph]);

  return snapshot;
}
