import type { GraphEdge, GraphNode } from "@suite/graph";
import { Background, Controls, type Edge, type Node, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useGraphSnapshot } from "../hooks/useGraphSnapshot";
import { nodeTypes } from "./NoteNode";

function toFlowNode(node: GraphNode): Node {
  return {
    id: node.id,
    type: "note",
    position: { x: node.position.x, y: node.position.y },
    data: { node },
  };
}

function toFlowEdge(edge: GraphEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  };
}

export function CanvasBoard() {
  const { nodes, edges } = useGraphSnapshot();
  const flowNodes = useMemo(() => nodes.map(toFlowNode), [nodes]);
  const flowEdges = useMemo(() => edges.map(toFlowEdge), [edges]);

  return (
    <div data-testid="canvas-board" className="h-full w-full">
      <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
