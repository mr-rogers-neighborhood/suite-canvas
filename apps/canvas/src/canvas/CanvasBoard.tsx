import type { GraphEdge, GraphNode, LayerAction } from "@suite/graph";
import {
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  MarkerType,
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

/** Share of the remaining distance covered per frame when easing toward a peer's drag. */
const SMOOTHING = 0.22;
const POINTER_THROTTLE_MS = 60;
const DRAG_THROTTLE_MS = 40;

const EDGE_TYPE: Record<GraphEdge["path"], Edge["type"]> = {
  bezier: "default",
  straight: "straight",
  step: "step",
  smoothstep: "smoothstep",
};

function toFlowEdge(edge: GraphEdge, selected: boolean, peerColor?: string): Edge {
  const marker = {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    ...(peerColor ? { color: peerColor } : {}),
  };

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: EDGE_TYPE[edge.path] ?? "default",
    selected,
    ...(edge.sourceConnector ? { sourceHandle: edge.sourceConnector } : {}),
    ...(edge.targetConnector ? { targetHandle: edge.targetConnector } : {}),
    ...(edge.label ? { label: edge.label } : {}),
    ...(peerColor ? { style: { stroke: peerColor, strokeWidth: 2 } } : {}),
    markerEnd: marker,
    ...(edge.bidirectional ? { markerStart: marker } : {}),
  };
}

export function CanvasBoard() {
  const { nodes: graphNodes, edges: graphEdges } = useGraphSnapshot();
  const graph = useCanvasStore((state) => state.graph);
  const peers = usePresenceStore((state) => state.peers);
  const setPointer = usePresenceStore((state) => state.setPointer);
  const setDragging = usePresenceStore((state) => state.setDragging);
  const setPresenceSelection = usePresenceStore((state) => state.setSelection);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
  const setSelectedEdgeIds = useUiStore((state) => state.setSelectedEdgeIds);
  const setEditingNodeId = useUiStore((state) => state.setEditingNodeId);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);
  const contextMenu = useUiStore((state) => state.contextMenu);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const locallyDraggingId = useRef<string | null>(null);
  const lastPointerSent = useRef(0);
  const lastDragSent = useRef(0);
  const selectedKey = selectedNodeIds.join(",");

  // Remote drags are eased toward their latest reported position so motion on a
  // collaborator's screen reads as continuous instead of stepping.
  const peerTargets = useRef(new Map<string, { x: number; y: number }>());
  const smoothPositions = useRef(new Map<string, { x: number; y: number }>());
  const smoothingFrame = useRef<number | null>(null);

  const runSmoothing = useCallback(() => {
    const tick = () => {
      let moving = false;
      for (const [id, target] of peerTargets.current) {
        const previous = smoothPositions.current.get(id) ?? target;
        const x = previous.x + (target.x - previous.x) * SMOOTHING;
        const y = previous.y + (target.y - previous.y) * SMOOTHING;
        const settled = Math.abs(target.x - x) < 0.5 && Math.abs(target.y - y) < 0.5;
        smoothPositions.current.set(id, settled ? { ...target } : { x, y });
        if (!settled) moving = true;
      }

      setNodes((current) =>
        current.map((node) => {
          const position = smoothPositions.current.get(node.id);
          if (!position) return node;
          if (position.x === node.position.x && position.y === node.position.y) return node;
          return { ...node, position };
        }),
      );

      smoothingFrame.current = moving ? requestAnimationFrame(tick) : null;
    };

    if (smoothingFrame.current !== null) return;
    smoothingFrame.current = requestAnimationFrame(tick);
  }, [setNodes]);

  useEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    for (const peer of Object.values(peers)) {
      if (peer.dragging) next.set(peer.dragging.nodeId, peer.dragging.position);
    }
    peerTargets.current = next;

    // Drop smoothing state for drags that ended so the CRDT position takes over.
    for (const id of smoothPositions.current.keys()) {
      if (!next.has(id)) smoothPositions.current.delete(id);
    }

    if (next.size > 0) runSmoothing();
  }, [peers, runSmoothing]);

  useEffect(
    () => () => {
      if (smoothingFrame.current !== null) cancelAnimationFrame(smoothingFrame.current);
    },
    [],
  );

  // React Flow owns transient state (drag position, selection), the CRDT owns
  // the truth. Re-derive flow nodes whenever either side changes.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      return graphNodes.map((graphNode: GraphNode) => {
        const existing = byId.get(graphNode.id);
        const position =
          locallyDraggingId.current === graphNode.id && existing
            ? existing.position
            : (smoothPositions.current.get(graphNode.id) ?? graphNode.position);
        return {
          id: graphNode.id,
          type: "note",
          position: { x: position.x, y: position.y },
          selected: selectedKey.split(",").includes(graphNode.id),
          zIndex: graphNode.z,
          data: { node: graphNode },
        } satisfies Node;
      });
    });
  }, [graphNodes, selectedKey, setNodes]);

  useEffect(() => {
    const peerByEdge = new Map<string, string>();
    for (const peer of Object.values(peers)) {
      for (const edgeId of peer.selection?.edgeIds ?? []) {
        if (!peerByEdge.has(edgeId)) peerByEdge.set(edgeId, peer.user.color);
      }
    }
    const selectedEdges = new Set(selectedEdgeIds);
    setEdges(
      graphEdges.map((edge) =>
        toFlowEdge(edge, selectedEdges.has(edge.id), peerByEdge.get(edge.id)),
      ),
    );
  }, [graphEdges, peers, selectedEdgeIds, setEdges]);

  useOnSelectionChange({
    onChange: ({ nodes: selectedNodes, edges: selectedEdges }) => {
      const ids = selectedNodes.map((node) => node.id);
      const edgeIds = selectedEdges.map((edge) => edge.id);
      setSelectedNodeIds(ids);
      setSelectedEdgeIds(edgeIds);
      setPresenceSelection(ids.length > 0 || edgeIds.length > 0 ? { nodeIds: ids, edgeIds } : null);
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

  // Selection elevates a card in React Flow, which would hide the new order, so
  // drop the selection once an explicit layer change lands.
  const changeLayer = useCallback(
    (nodeId: string, action: LayerAction) => {
      graph.moveNodeLayer(nodeId, action);
      setSelectedNodeIds([]);
      setPresenceSelection(null);
    },
    [graph, setSelectedNodeIds, setPresenceSelection],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      graph.addEdge({
        source: connection.source,
        target: connection.target,
        ...(connection.sourceHandle ? { sourceConnector: connection.sourceHandle } : {}),
        ...(connection.targetHandle ? { targetConnector: connection.targetHandle } : {}),
      });
    },
    [graph],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      if (!connection.source || !connection.target) return;
      // React Flow keeps the anchored end intact, so an unchanged source means the target moved.
      const end: "source" | "target" =
        connection.source === oldEdge.source && connection.sourceHandle === oldEdge.sourceHandle
          ? "target"
          : "source";
      const nodeId = end === "source" ? connection.source : connection.target;
      const connectorId = end === "source" ? connection.sourceHandle : connection.targetHandle;
      graph.reconnectEdge(oldEdge.id, end, nodeId, connectorId ?? undefined);
    },
    [graph],
  );

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
    const nodeId = contextMenu.nodeId;
    const edgeId = contextMenu.edgeId;

    if (contextMenu.kind === "edge" && edgeId) {
      const edge = graph.getEdge(edgeId);
      return [
        {
          label: "Reverse direction",
          onSelect: () => graph.reverseEdge(edgeId),
        },
        {
          label: edge?.bidirectional ? "Make one-way" : "Make bidirectional",
          onSelect: () => graph.setEdgeBidirectional(edgeId, !edge?.bidirectional),
        },
        {
          label: "Path",
          items: [
            {
              label: edge?.path === "bezier" ? "Curved ✓" : "Curved",
              onSelect: () => graph.setEdgePath(edgeId, "bezier"),
            },
            {
              label: edge?.path === "straight" ? "Straight ✓" : "Straight",
              onSelect: () => graph.setEdgePath(edgeId, "straight"),
            },
            {
              label: edge?.path === "step" ? "Step ✓" : "Step",
              onSelect: () => graph.setEdgePath(edgeId, "step"),
            },
            {
              label: edge?.path === "smoothstep" ? "Smooth step ✓" : "Smooth step",
              onSelect: () => graph.setEdgePath(edgeId, "smoothstep"),
            },
          ],
        },
        {
          label: "Delete link",
          danger: true,
          onSelect: () => graph.removeEdge(edgeId),
        },
      ];
    }

    if (contextMenu.kind === "connector") {
      return [
        {
          label: "Reposition Connector",
          onSelect: () => {
            if (nodeId && contextMenu.connectorId) {
              setSelectedConnector({ nodeId, connectorId: contextMenu.connectorId });
            }
          },
        },
        {
          label: "Delete connector",
          danger: true,
          onSelect: () => {
            if (nodeId && contextMenu.connectorId) {
              graph.removeConnector(nodeId, contextMenu.connectorId);
              setSelectedConnector(null);
            }
          },
        },
      ];
    }

    return [
      {
        label: "Add connector",
        onSelect: () => {
          if (nodeId) graph.addConnector(nodeId);
        },
      },
      {
        label: "Position",
        items: [
          {
            label: "Bring Forward",
            onSelect: () => nodeId && changeLayer(nodeId, "forward"),
          },
          {
            label: "Bring to Front",
            onSelect: () => nodeId && changeLayer(nodeId, "front"),
          },
          {
            label: "Send Back",
            onSelect: () => nodeId && changeLayer(nodeId, "backward"),
          },
          {
            label: "Send to Back",
            onSelect: () => nodeId && changeLayer(nodeId, "back"),
          },
        ],
      },
      {
        label: "Delete note",
        danger: true,
        onSelect: () => {
          if (nodeId) {
            graph.removeNode(nodeId);
            setSelectedNodeIds([]);
          }
        },
      },
    ];
  }, [contextMenu, graph, createNoteAt, changeLayer, setSelectedNodeIds, setSelectedConnector]);

  return (
    <div
      data-testid="canvas-board"
      className={`h-full w-full ${selectedConnector ? "connector-active" : ""}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={null}
        connectionMode={ConnectionMode.Loose}
        onConnect={onConnect}
        onReconnect={onReconnect}
        edgesReconnectable
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          openContextMenu({ x: event.clientX, y: event.clientY, kind: "edge", edgeId: edge.id });
        }}
        onEdgeClick={() => setSelectedConnector(null)}
        onNodeDragStart={(_, node) => {
          locallyDraggingId.current = node.id;
          setDragging({ nodeId: node.id, position: node.position });
        }}
        onNodeDrag={(_, node) => {
          const now = performance.now();
          if (now - lastDragSent.current < DRAG_THROTTLE_MS) return;
          lastDragSent.current = now;
          setDragging({ nodeId: node.id, position: node.position });
        }}
        onNodeDragStop={(_, node) => {
          locallyDraggingId.current = null;
          setDragging(null);
          graph.updateNodePosition(node.id, node.position);
        }}
        onPaneClick={() => setSelectedConnector(null)}
        onNodeClick={() => setSelectedConnector(null)}
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
          if (now - lastPointerSent.current < POINTER_THROTTLE_MS) return;
          lastPointerSent.current = now;
          setPointer(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}
        onPaneMouseLeave={() => setPointer(null)}
      >
        <Background color="var(--rf-dot)" />
        <Controls showInteractive={false} />
        <PresenceLayer />
      </ReactFlow>
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
