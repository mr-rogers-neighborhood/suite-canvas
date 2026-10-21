import type { GraphNode } from "@suite/graph";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import { useMemo } from "react";
import type { PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { type ConnectorPeerState, NodeCard } from "../components/NodeCard";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

export function NoteNode({ id, data, selected }: NodeProps) {
  const node = data.node as GraphNode;
  const graph = useCanvasStore((state) => state.graph);
  const awareness = usePresenceStore((state) => state.awareness);
  const peers = usePresenceStore((state) => state.peers);
  const editing = useUiStore((state) => state.editingNodeId === id);
  const setEditingNodeId = useUiStore((state) => state.setEditingNodeId);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const setMovingConnector = usePresenceStore((state) => state.setMovingConnector);
  const openContextMenu = useUiStore((state) => state.openContextMenu);

  const fragment = useMemo(() => graph.getContent(id), [graph, id]);

  const presence = useMemo<PresenceUser[]>(() => {
    return Object.values(peers)
      .filter((peer) => peer.focus?.nodeId === id)
      .map((peer) => peer.user);
  }, [peers, id]);

  const draggingPeers = useMemo<PresenceUser[]>(() => {
    return Object.values(peers)
      .filter((peer) => peer.dragging?.nodeId === id)
      .map((peer) => peer.user);
  }, [peers, id]);

  const movingConnectorPeers = useMemo<Record<string, ConnectorPeerState>>(() => {
    const result: Record<string, ConnectorPeerState> = {};
    for (const peer of Object.values(peers)) {
      const moving = peer.connector;
      if (moving?.nodeId !== id) continue;
      const entry = result[moving.connectorId] ?? { users: [], position: null };
      entry.users.push(peer.user);
      entry.position = entry.position ?? moving.position ?? null;
      result[moving.connectorId] = entry;
    }
    return result;
  }, [peers, id]);

  const selectingConnectorPeers = useMemo<Record<string, PresenceUser[]>>(() => {
    const result: Record<string, PresenceUser[]> = {};
    for (const peer of Object.values(peers)) {
      const selected = peer.selection?.connector;
      if (selected?.nodeId !== id) continue;
      const list = result[selected.connectorId] ?? [];
      list.push(peer.user);
      result[selected.connectorId] = list;
    }
    return result;
  }, [peers, id]);

  const selectingPeers = useMemo<PresenceUser[]>(() => {
    return Object.values(peers)
      .filter((peer) => peer.selection?.nodeIds.includes(id))
      .map((peer) => peer.user);
  }, [peers, id]);

  return (
    <div>
      <NodeCard
        node={node}
        fragment={fragment}
        awareness={awareness}
        selected={selected}
        editing={editing}
        presence={presence}
        draggingPeers={draggingPeers}
        selectingPeers={selectingPeers}
        movingConnectorPeers={movingConnectorPeers}
        selectingConnectorPeers={selectingConnectorPeers}
        onConnectorMoveStart={(connectorId) => setMovingConnector({ nodeId: id, connectorId })}
        onConnectorMove={(connectorId, position) =>
          setMovingConnector({ nodeId: id, connectorId, position })
        }
        onConnectorMoveFinished={() => setMovingConnector(null)}
        selectedConnectorId={
          selectedConnector?.nodeId === id ? selectedConnector.connectorId : null
        }
        onConnectorSelect={(connectorId) => setSelectedConnector({ nodeId: id, connectorId })}
        onConnectorMoveEnd={(connectorId, position) =>
          graph.moveConnector(id, connectorId, position)
        }
        onConnectorContextMenu={(event, connectorId) =>
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            kind: "connector",
            nodeId: id,
            connectorId,
          })
        }
        onEditEnd={() => setEditingNodeId(null)}
      />
    </div>
  );
}

export const nodeTypes = { note: NoteNode } satisfies NodeTypes;
