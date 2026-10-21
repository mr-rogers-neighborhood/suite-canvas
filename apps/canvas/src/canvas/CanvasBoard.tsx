import type { Card, GraphEdge, LayerAction, Placement } from "@suite/graph";
import {
  Background,
  type Connection,
  ConnectionMode,
  Controls,
  type Edge,
  type HandleType,
  MarkerType,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useOnSelectionChange,
  useReactFlow,
  useStoreApi,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useWorkspaceSnapshot } from "../hooks/useWorkspaceSnapshot";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { nodeTypes } from "./NoteNode";
import { PeerReconnectLayer } from "./PeerReconnectLayer";
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
  const snapshot = useWorkspaceSnapshot();
  const workspace = useCanvasStore((state) => state.workspace);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const peers = useBoardPeers(activeBoardId);
  const setPointer = usePresenceStore((state) => state.setPointer);
  const setDragging = usePresenceStore((state) => state.setDragging);
  const setPresenceSelection = usePresenceStore((state) => state.setSelection);
  const setReconnect = usePresenceStore((state) => state.setReconnect);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
  const setSelectedEdgeIds = useUiStore((state) => state.setSelectedEdgeIds);
  const startEditing = useUiStore((state) => state.startEditing);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);
  const contextMenu = useUiStore((state) => state.contextMenu);
  const { screenToFlowPosition } = useReactFlow();
  const store = useStoreApi();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reconnecting, setReconnecting] = useState<{
    edgeId: string;
    end: HandleType;
    /** The connector that stays put, so a snap onto it is not mistaken for a target. */
    anchorConnector: string | null;
  } | null>(null);

  // Board-scoped views derived from the snapshot, so a CRDT change anywhere
  // recomputes exactly once per board.
  const boardPlacements = useMemo(() => {
    const map = new Map<string, Placement>();
    if (!activeBoardId) return map;
    for (const placement of snapshot.placements) {
      if (placement.boardId === activeBoardId) map.set(placement.cardId, placement);
    }
    return map;
  }, [snapshot, activeBoardId]);

  const cardsById = useMemo(
    () => new Map(snapshot.cards.map((card) => [card.id, card])),
    [snapshot],
  );

  const boardCards: Card[] = useMemo(() => {
    if (!activeBoardId) return [];
    return [...boardPlacements.values()]
      .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId))
      .flatMap((placement) => {
        const card = cardsById.get(placement.cardId);
        return card && !card.deletedAt ? [card] : [];
      });
  }, [boardPlacements, cardsById, activeBoardId]);

  const boardEdges: GraphEdge[] = useMemo(() => {
    if (!activeBoardId) return [];
    const placed = new Set(boardCards.map((card) => card.id));
    return snapshot.edges.filter(
      (edge) =>
        edge.boardId === activeBoardId && placed.has(edge.source) && placed.has(edge.target),
    );
  }, [snapshot, boardCards, activeBoardId]);

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
      return boardCards.flatMap((card: Card) => {
        const placement = boardPlacements.get(card.id);
        if (!placement) return [];
        const existing = byId.get(card.id);
        const position =
          locallyDraggingId.current === card.id && existing
            ? existing.position
            : (smoothPositions.current.get(card.id) ?? { x: placement.x, y: placement.y });
        return [
          {
            id: card.id,
            type: "note",
            position: { x: position.x, y: position.y },
            selected: selectedKey.split(",").includes(card.id),
            zIndex: placement.z,
            data: { card, placement },
          } satisfies Node,
        ];
      });
    });
  }, [boardCards, boardPlacements, selectedKey, setNodes]);

  useEffect(() => {
    const peerByEdge = new Map<string, string>();
    for (const peer of Object.values(peers)) {
      for (const edgeId of peer.selection?.edgeIds ?? []) {
        if (!peerByEdge.has(edgeId)) peerByEdge.set(edgeId, peer.user.color);
      }
    }

    const selectedEdges = new Set(selectedEdgeIds);

    // While a peer drags one end of a link, their dashed preview replaces it.
    const reconnecting = new Set<string>();
    for (const peer of Object.values(peers)) {
      if (peer.reconnect) reconnecting.add(peer.reconnect.edgeId);
    }

    const flowEdges: Edge[] = boardEdges.map((edge) => {
      const flowEdge = toFlowEdge(edge, selectedEdges.has(edge.id), peerByEdge.get(edge.id));
      return reconnecting.has(edge.id) ? { ...flowEdge, hidden: true } : flowEdge;
    });
    setEdges(flowEdges);
  }, [boardEdges, peers, selectedEdgeIds, setEdges]);

  useOnSelectionChange({
    onChange: ({ nodes: selectedNodes, edges: selectedEdges }) => {
      setSelectedNodeIds(selectedNodes.map((node) => node.id));
      setSelectedEdgeIds(selectedEdges.map((edge) => edge.id));
    },
  });

  // One publisher for everything a peer has selected, including the connector
  // they clicked, so no component has to reason about who else is selected.
  useEffect(() => {
    const connector = selectedConnector
      ? { nodeId: selectedConnector.nodeId, connectorId: selectedConnector.connectorId }
      : undefined;
    const hasSelection =
      selectedNodeIds.length > 0 || selectedEdgeIds.length > 0 || connector !== undefined;

    setPresenceSelection(
      hasSelection
        ? {
            nodeIds: selectedNodeIds,
            edgeIds: selectedEdgeIds,
            ...(connector ? { connector } : {}),
          }
        : null,
    );
  }, [selectedConnector, selectedEdgeIds, selectedNodeIds, setPresenceSelection]);

  const unplaceSelected = useCallback(() => {
    const state = useUiStore.getState();
    if (!activeBoardId) return;
    for (const id of state.selectedNodeIds) {
      workspace.unplaceCard(activeBoardId, id);
    }
    state.setSelectedNodeIds([]);
    state.stopEditing();
  }, [workspace, activeBoardId]);

  const trashSelected = useCallback(() => {
    const state = useUiStore.getState();
    for (const id of state.selectedNodeIds) {
      workspace.trashCard(id);
    }
    state.setSelectedNodeIds([]);
    state.stopEditing();
  }, [workspace]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const state = useUiStore.getState();

      if (event.key === "Escape" && state.editingNodeId) {
        state.stopEditing();
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (isTyping || state.selectedNodeIds.length === 0) return;
        event.preventDefault();
        if (event.shiftKey) trashSelected();
        else unplaceSelected();
        return;
      }

      if (event.key === "Enter" && !isTyping && !state.editingNodeId) {
        const first = state.selectedNodeIds[0];
        if (first) {
          event.preventDefault();
          state.startEditing(first, "body");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [trashSelected, unplaceSelected]);

  // Selection elevates a card in React Flow, which would hide the new order, so
  // drop the selection once an explicit layer change lands.
  const changeLayer = useCallback(
    (nodeId: string, action: LayerAction) => {
      if (!activeBoardId) return;
      workspace.moveLayer(activeBoardId, nodeId, action);
      setSelectedNodeIds([]);
      setPresenceSelection(null);
    },
    [workspace, activeBoardId, setSelectedNodeIds, setPresenceSelection],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (!activeBoardId) return;
      workspace.addEdge({
        boardId: activeBoardId,
        source: connection.source,
        target: connection.target,
        ...(connection.sourceHandle ? { sourceConnector: connection.sourceHandle } : {}),
        ...(connection.targetHandle ? { targetConnector: connection.targetHandle } : {}),
      });
    },
    [workspace, activeBoardId],
  );

  // React Flow reports nothing while a reconnect drag moves, so follow the
  // pointer ourselves and publish the endpoint for peers to preview.
  useEffect(() => {
    if (!reconnecting) return;

    let lastSent = 0;
    let pending: { x: number; y: number } | null = null;
    let trailing: ReturnType<typeof setTimeout> | null = null;

    const publish = (position: { x: number; y: number }) => {
      // React Flow already resolves the snap target while the drag is in flight;
      // forward it so peers stop exactly where the mover's link would land.
      const { connection } = store.getState();
      const snapped = connection.isValid
        ? [connection.toHandle, connection.fromHandle].find(
            (handle) => handle && handle.id !== reconnecting.anchorConnector,
          )
        : undefined;

      setReconnect({
        edgeId: reconnecting.edgeId,
        end: reconnecting.end,
        position,
        ...(snapped?.nodeId && snapped.id
          ? { target: { nodeId: snapped.nodeId, connectorId: snapped.id } }
          : {}),
      });
    };

    const follow = (event: PointerEvent) => {
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const wait = DRAG_THROTTLE_MS - (performance.now() - lastSent);
      if (wait <= 0) {
        lastSent = performance.now();
        publish(position);
        return;
      }
      // Always deliver the latest position, even if no further move arrives.
      pending = position;
      if (trailing !== null) return;
      trailing = setTimeout(() => {
        trailing = null;
        if (!pending) return;
        lastSent = performance.now();
        publish(pending);
        pending = null;
      }, wait);
    };

    window.addEventListener("pointermove", follow);
    return () => {
      window.removeEventListener("pointermove", follow);
      // The drop already rewrote the edge, so never re-publish here: onReconnectEnd
      // clears the field first and a late sample would resurrect the preview.
      if (trailing !== null) clearTimeout(trailing);
    };
  }, [reconnecting, screenToFlowPosition, setReconnect, store]);

  const onReconnectStart = useCallback(
    (event: React.MouseEvent, edge: Edge, handleType: HandleType) => {
      // React Flow reports the handle that stays anchored, so the other end moves.
      const end: HandleType = handleType === "source" ? "target" : "source";
      setReconnecting({
        edgeId: edge.id,
        end,
        anchorConnector: (handleType === "source" ? edge.sourceHandle : edge.targetHandle) ?? null,
      });
      setReconnect({
        edgeId: edge.id,
        end,
        position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [screenToFlowPosition, setReconnect],
  );

  const onReconnectStop = useCallback(() => {
    setReconnecting(null);
    setReconnect(null);
  }, [setReconnect]);

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
      workspace.reconnectEdge(oldEdge.id, end, nodeId, connectorId ?? undefined);
    },
    [workspace],
  );

  const createNoteAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!activeBoardId) return;
      const card = workspace.createCard({ boardId: activeBoardId, position });
      setSelectedNodeIds([card.id]);
      startEditing(card.id, "title");
    },
    [workspace, activeBoardId, setSelectedNodeIds, startEditing],
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
      const edge = workspace.getEdge(edgeId);
      return [
        {
          label: "Reverse direction",
          onSelect: () => workspace.reverseEdge(edgeId),
        },
        {
          label: edge?.bidirectional ? "Make one-way" : "Make bidirectional",
          onSelect: () => workspace.setEdgeBidirectional(edgeId, !edge?.bidirectional),
        },
        {
          label: "Path",
          items: [
            {
              label: edge?.path === "bezier" ? "Curved ✓" : "Curved",
              onSelect: () => workspace.setEdgePath(edgeId, "bezier"),
            },
            {
              label: edge?.path === "straight" ? "Straight ✓" : "Straight",
              onSelect: () => workspace.setEdgePath(edgeId, "straight"),
            },
            {
              label: edge?.path === "step" ? "Step ✓" : "Step",
              onSelect: () => workspace.setEdgePath(edgeId, "step"),
            },
            {
              label: edge?.path === "smoothstep" ? "Smooth step ✓" : "Smooth step",
              onSelect: () => workspace.setEdgePath(edgeId, "smoothstep"),
            },
          ],
        },
        {
          label: "Delete link",
          danger: true,
          onSelect: () => workspace.removeEdge(edgeId),
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
              workspace.removeConnector(nodeId, contextMenu.connectorId);
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
          if (nodeId) workspace.addConnector(nodeId);
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
        label: "Remove from board",
        onSelect: () => {
          if (nodeId && activeBoardId) {
            workspace.unplaceCard(activeBoardId, nodeId);
            setSelectedNodeIds([]);
            setSelectedConnector(null);
          }
        },
      },
      {
        label: "Delete card",
        danger: true,
        onSelect: () => {
          if (nodeId) {
            workspace.trashCard(nodeId);
            setSelectedNodeIds([]);
            setSelectedConnector(null);
          }
        },
      },
    ];
  }, [
    contextMenu,
    workspace,
    activeBoardId,
    createNoteAt,
    changeLayer,
    setSelectedNodeIds,
    setSelectedConnector,
  ]);

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
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectStop}
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
          if (activeBoardId)
            workspace.updatePlacementPosition(activeBoardId, node.id, node.position);
        }}
        onPaneClick={() => setSelectedConnector(null)}
        onNodeClick={() => setSelectedConnector(null)}
        onNodeDoubleClick={(_, node) => startEditing(node.id, "body")}
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
        <PeerReconnectLayer />
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
