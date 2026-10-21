import type { GraphEdge, GraphNode } from "@suite/graph";
import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useOnSelectionChange,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { useGraphSnapshot } from "../hooks/useGraphSnapshot";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { nodeTypes } from "./NoteNode";
import { PresenceLayer } from "./PresenceLayer";

function toFlowEdge(edge: GraphEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  };
}

export function CanvasBoard() {
  const { nodes: graphNodes, edges: graphEdges } = useGraphSnapshot();
  const graph = useCanvasStore((state) => state.graph);
  const setPointer = usePresenceStore((state) => state.setPointer);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const setEditingNodeId = useUiStore((state) => state.setEditingNodeId);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);
  const contextMenu = useUiStore((state) => state.contextMenu);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const draggingId = useRef<string | null>(null);
  const lastPointerSent = useRef(0);
  const selectedKey = selectedNodeIds.join(",");

  // React Flow owns transient state (drag position, selection), the CRDT owns
  // the truth. Re-derive flow nodes whenever either side changes.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      return graphNodes.map((graphNode: GraphNode) => {
        const existing = byId.get(graphNode.id);
        const position =
          draggingId.current === graphNode.id && existing ? existing.position : graphNode.position;
        return {
          id: graphNode.id,
          type: "note",
          position: { x: position.x, y: position.y },
          selected: selectedKey.split(",").includes(graphNode.id),
          data: { node: graphNode },
        } satisfies Node;
      });
    });
  }, [graphNodes, selectedKey, setNodes]);

  useEffect(() => {
    setEdges(graphEdges.map(toFlowEdge));
  }, [graphEdges, setEdges]);

  useOnSelectionChange({
    onChange: ({ nodes: selected }) => {
      setSelectedNodeIds(selected.map((node) => node.id));
    },
  });

  const deleteSelected = useCallback(() => {
    const state = useUiStore.getState();
    for (const id of state.selectedNodeIds) {
      graph.removeNode(id);
    }
    state.setSelectedNodeIds([]);
  }, [graph]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const state = useUiStore.getState();

      if (event.key === "Escape" && state.editingNodeId) {
        state.setEditingNodeId(null);
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (isTyping || state.selectedNodeIds.length === 0) return;
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (event.key === "Enter" && !isTyping && !state.editingNodeId) {
        const first = state.selectedNodeIds[0];
        if (first) {
          event.preventDefault();
          state.setEditingNodeId(first);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteSelected]);

  const createNoteAt = useCallback(
    (position: { x: number; y: number }) => {
      const node = graph.createNote({ id: crypto.randomUUID(), position });
      setSelectedNodeIds([node.id]);
      setEditingNodeId(node.id);
    },
    [graph, setSelectedNodeIds, setEditingNodeId],
  );

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenu) return [];
    if (contextMenu.kind === "canvas") {
      return [
        {
          label: "New note",
          onSelect: () => {
            if (contextMenu.flowPosition) createNoteAt(contextMenu.flowPosition);
          },
        },
      ];
    }
    return [
      {
        label: "Delete note",
        danger: true,
        onSelect: () => {
          if (contextMenu.nodeId) {
            graph.removeNode(contextMenu.nodeId);
            setSelectedNodeIds([]);
          }
        },
      },
    ];
  }, [contextMenu, graph, createNoteAt, setSelectedNodeIds]);

  return (
    <div data-testid="canvas-board" className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={null}
        onNodeDragStart={(_, node) => {
          draggingId.current = node.id;
        }}
        onNodeDragStop={(_, node) => {
          draggingId.current = null;
          graph.updateNodePosition(node.id, node.position);
        }}
        onNodeDoubleClick={(_, node) => setEditingNodeId(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          openContextMenu({ x: event.clientX, y: event.clientY, kind: "node", nodeId: node.id });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          openContextMenu({ x: event.clientX, y: event.clientY, kind: "canvas", flowPosition });
        }}
        onPaneMouseMove={(event) => {
          const now = performance.now();
          if (now - lastPointerSent.current < 80) return;
          lastPointerSent.current = now;
          setPointer({ x: event.clientX, y: event.clientY });
        }}
        onPaneMouseLeave={() => setPointer(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
      <PresenceLayer />
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}
