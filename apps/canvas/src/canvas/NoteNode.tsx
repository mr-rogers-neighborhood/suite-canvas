import type { Card, CardType, Placement } from "@suite/graph";
import { type NodeProps, NodeResizer, type NodeTypes, type ResizeParams } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { CardMeta } from "../cards/cardMeta";
import type { PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { type ConnectorPeerState, NodeCard } from "../components/NodeCard";
import { countRender } from "../dev/perf";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCardContainers } from "../hooks/useCardContainers";
import { useReferenceCount } from "../hooks/useReferenceCounts";
import { useSmoothedSize } from "../hooks/useSmoothedSize";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

export function NoteNode({ id, data, selected }: NodeProps) {
  countRender("note");

  const { card, placement, type, meta } = data as {
    card: Card;
    placement: Placement;
    type: CardType;
    meta: CardMeta;
  };
  const workspace = useCanvasStore((state) => state.workspace);
  const cursorStore = useCanvasStore((state) => state.cursors);
  const peers = useBoardPeers(placement.boardId);
  const localUser = usePresenceStore((state) => state.localUser);
  const setMovingConnector = usePresenceStore((state) => state.setMovingConnector);
  const setResizing = usePresenceStore((state) => state.setResizing);

  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const startEditing = useUiStore((state) => state.startEditing);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const openInspector = useUiStore((state) => state.openInspector);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canManage = useUiStore((state) => state.canManage);
  const metaExpanded = useUiStore((state) => Boolean(state.expandedCardMeta[id]));
  const toggleCardMeta = useUiStore((state) => state.toggleCardMeta);

  // Container ids are stable; resolving them through the container observer
  // lets a card that mounted before the body existed adopt it without
  // subscribing to every other card on the board.
  const containers = useCardContainers(id);
  // A number, not the snapshot: the header chip only re-renders when it moves.
  const linkCount = useReferenceCount(id);
  const contentId = useMemo(
    () => containers.contentId ?? workspace.getContent(id).id,
    [workspace, id, containers],
  );
  const titleId = useMemo(
    () => containers.titleId ?? workspace.getTitle(id).id,
    [workspace, id, containers],
  );

  const presence = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.focus?.nodeId === id).map((peer) => peer.user),
    [peers, id],
  );

  const draggingPeers = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.dragging?.nodeId === id).map((peer) => peer.user),
    [peers, id],
  );

  // A multi-card drag labels its group outline, not the card under the pointer.
  const draggingGroup = useMemo(
    () =>
      peers.some(
        (peer) => peer.dragging?.nodeId === id && (peer.dragging.nodeIds?.length ?? 0) > 1,
      ),
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

  const resizingPeers = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.resizing?.nodeId === id).map((peer) => peer.user),
    [peers, id],
  );
  const peerResize = peers.find((peer) => peer.resizing?.nodeId === id)?.resizing ?? null;
  const peerSize = useSmoothedSize(
    peerResize ? { width: peerResize.width, height: peerResize.height } : null,
  );

  // Live size while this client drags a resize handle; peers get it throttled and
  // the CRDT records only the final geometry.
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null);
  const lastResizeSent = useRef(0);

  const handleResize = useCallback(
    (_event: unknown, params: ResizeParams) => {
      setLiveSize({ width: params.width, height: params.height });
      const now = performance.now();
      if (now - lastResizeSent.current < 40) return;
      lastResizeSent.current = now;
      // React Flow moves the node when the top or left edge is dragged, so peers
      // need the corner as well as the size to see the same transformation.
      setResizing({
        nodeId: id,
        position: { x: params.x, y: params.y },
        width: params.width,
        height: params.height,
      });
    },
    [id, setResizing],
  );

  const handleResizeEnd = useCallback(
    (_event: unknown, params: ResizeParams) => {
      workspace.updatePlacementGeometry(placement.boardId, id, {
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      });
      setResizing(null);
      setLiveSize(null);
    },
    [workspace, placement.boardId, id, setResizing],
  );

  const panelOwnsCard = editingNodeId === id && editingSurface === "panel";
  const width = liveSize?.width ?? peerSize?.width ?? placement.width ?? null;
  const height = liveSize?.height ?? peerSize?.height ?? placement.height ?? null;

  return (
    <div>
      <NodeResizer
        isVisible={
          canEditLayout &&
          Boolean(selected) &&
          !(editingNodeId === id && editingSurface === "canvas")
        }
        minWidth={160}
        minHeight={80}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        lineStyle={{ borderColor: "var(--ink-muted)", borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: "var(--ink)" }}
      />
      <NodeCard
        card={card}
        type={type}
        meta={meta}
        metaExpanded={metaExpanded}
        onToggleMeta={() => toggleCardMeta(id)}
        cardDoc={workspace.doc}
        contentId={contentId}
        titleId={titleId}
        // The panel is the only surface publishing carets for this card while it
        // owns editing; a read-only canvas twin must not clear that cursor.
        cursorStore={panelOwnsCard ? null : cursorStore}
        localUser={localUser}
        boardId={placement.boardId}
        width={width}
        height={height}
        selected={selected}
        editing={editingNodeId === id && editingSurface === "canvas" ? editingField : null}
        presence={presence}
        draggingPeers={draggingPeers}
        showDragLabel={!draggingGroup}
        selectingPeers={selectingPeers}
        resizingPeers={resizingPeers}
        movingConnectorPeers={movingConnectorPeers}
        selectingConnectorPeers={selectingConnectorPeers}
        canEditContent={canEditContent}
        canEditLayout={canEditLayout}
        canManage={canManage}
        onStartEditing={(field) => startEditing(id, field, "canvas")}
        onEditEnd={stopEditing}
        {...(canEditLayout
          ? { onRemoveFromBoard: () => workspace.unplaceCard(placement.boardId, id) }
          : {})}
        linkCount={linkCount}
        onOpenInfo={() => openInspector(id)}
        {...(canManage ? { onTrash: () => workspace.trashCard(id) } : {})}
        onConnectorMoveStart={(connectorId) => {
          if (!canManage) return;
          setMovingConnector({ nodeId: id, connectorId });
        }}
        onConnectorMove={(connectorId, position) => {
          if (!canManage) return;
          setMovingConnector({ nodeId: id, connectorId, position });
        }}
        onConnectorMoveFinished={() => setMovingConnector(null)}
        selectedConnectorId={
          selectedConnector?.nodeId === id ? selectedConnector.connectorId : null
        }
        onConnectorSelect={(connectorId) => setSelectedConnector({ nodeId: id, connectorId })}
        onConnectorMoveEnd={(connectorId, position) => {
          if (!canManage) return;
          workspace.moveConnector(id, connectorId, position);
        }}
        onConnectorContextMenu={(event, connectorId) => {
          if (!canManage) return;
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            kind: "connector",
            nodeId: id,
            connectorId,
          });
        }}
      />
    </div>
  );
}

export const nodeTypes = { note: NoteNode } satisfies NodeTypes;
