import type { Card, Placement } from "@suite/graph";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import { useMemo } from "react";
import type { PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { type CardReference, type ConnectorPeerState, NodeCard } from "../components/NodeCard";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useWorkspaceSnapshot } from "../hooks/useWorkspaceSnapshot";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

export function NoteNode({ id, data, selected }: NodeProps) {
  const { card, placement } = data as { card: Card; placement: Placement };
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const peers = useBoardPeers(placement.boardId);
  const awareness = usePresenceStore((state) => state.awareness);
  const setMovingConnector = usePresenceStore((state) => state.setMovingConnector);

  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const startEditing = useUiStore((state) => state.startEditing);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const setActiveBoardId = useUiStore((state) => state.setActiveBoardId);
  const openContextMenu = useUiStore((state) => state.openContextMenu);

  const fragment = useMemo(() => workspace.getContent(id), [workspace, id]);
  const titleFragment = useMemo(() => workspace.getTitle(id), [workspace, id]);

  const presence = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.focus?.nodeId === id).map((peer) => peer.user),
    [peers, id],
  );

  const draggingPeers = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.dragging?.nodeId === id).map((peer) => peer.user),
    [peers, id],
  );

  const movingConnectorPeers = useMemo<Record<string, ConnectorPeerState>>(() => {
    const result: Record<string, ConnectorPeerState> = {};
    for (const peer of peers) {
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
    for (const peer of peers) {
      const selected = peer.selection?.connector;
      if (selected?.nodeId !== id) continue;
      const list = result[selected.connectorId] ?? [];
      list.push(peer.user);
      result[selected.connectorId] = list;
    }
    return result;
  }, [peers, id]);

  const selectingPeers = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.selection?.nodeIds.includes(id)).map((peer) => peer.user),
    [peers, id],
  );

  // Every board holding this card, home first, so the footer can show sharing.
  const references = useMemo<CardReference[]>(() => {
    const boardsById = new Map(snapshot.boards.map((board) => [board.id, board]));
    const placements = snapshot.placements
      .filter((entry) => entry.cardId === id)
      .sort((a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId));
    const home = placements[0]?.boardId ?? null;

    return placements
      .flatMap((entry) => {
        const board = boardsById.get(entry.boardId);
        if (!board) return [];
        return [
          {
            boardId: entry.boardId,
            boardName: board.name,
            isHome: entry.boardId === home,
            isCurrent: entry.boardId === placement.boardId,
          },
        ];
      })
      .sort(
        (a, b) => Number(b.isHome) - Number(a.isHome) || a.boardName.localeCompare(b.boardName),
      );
  }, [snapshot, id, placement.boardId]);

  return (
    <div>
      <NodeCard
        card={card}
        fragment={fragment}
        titleFragment={titleFragment}
        awareness={awareness}
        boardId={placement.boardId}
        references={references}
        selected={selected}
        editing={editingNodeId === id ? editingField : null}
        presence={presence}
        draggingPeers={draggingPeers}
        selectingPeers={selectingPeers}
        movingConnectorPeers={movingConnectorPeers}
        selectingConnectorPeers={selectingConnectorPeers}
        onStartEditing={(field) => startEditing(id, field)}
        onEditEnd={stopEditing}
        onGoToBoard={(boardId) => setActiveBoardId(boardId)}
        onRemoveFromBoard={() => workspace.unplaceCard(placement.boardId, id)}
        onTrash={() => workspace.trashCard(id)}
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
          workspace.moveConnector(id, connectorId, position)
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
      />
    </div>
  );
}

export const nodeTypes = { note: NoteNode } satisfies NodeTypes;
