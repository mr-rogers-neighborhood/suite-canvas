import { type NodeProps, NodeResizer, type NodeTypes, type ResizeParams } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { portalTargetId } from "../cards/portal";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useSmoothedSize } from "../hooks/useSmoothedSize";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { useAttachmentSource } from "../styles/useBoardCover";
import { cardIcon } from "./entityIcon";
import { NodeConnectors } from "./NodeConnectors";
import type { CardNodeData } from "./nodeData";
import { DEFAULT_PORTAL_SIZE, PORTAL_HEADER_HEIGHT, PortalCard } from "./PortalCard";
import { boardMiniature, miniatureDots } from "./portalMiniature";
import { useNodeConnectorWiring } from "./useNodeConnectorWiring";

/**
 * A portal as React Flow sees it. The card is one node among the board's cards
 * (selection, drag, resize and the node menu are the canvas's own); the only
 * thing it adds is the miniature of another board, derived from the snapshot.
 */
export function PortalNode({ id, data, selected }: NodeProps) {
  const { card, placement, type } = data as CardNodeData;
  const snapshot = useWorkspaceSnapshot();
  const workspace = useCanvasStore((state) => state.workspace);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const requestPortalEntry = useUiStore((state) => state.requestPortalEntry);
  const openContainerInspector = useUiStore((state) => state.openContainerInspector);
  const setResizing = usePresenceStore((state) => state.setResizing);

  const targetBoardId = portalTargetId(card);
  const board = targetBoardId
    ? snapshot.boards.find((entry) => entry.id === targetBoardId)
    : undefined;

  // Falls back to the live picture whenever the bytes are not here: an
  // attachment travels beside the document, so a peer may not have it yet.
  const cover = useAttachmentSource(board?.coverAttachmentId);

  const targetPlacements = useMemo(
    () =>
      targetBoardId ? snapshot.placements.filter((entry) => entry.boardId === targetBoardId) : [],
    [snapshot.placements, targetBoardId],
  );
  const targetSections = useMemo(
    () =>
      targetBoardId ? snapshot.sections.filter((entry) => entry.boardId === targetBoardId) : [],
    [snapshot.sections, targetBoardId],
  );
  // Re-derived from the snapshot, never stored: the target's version vector is
  // enough to redraw this miniature when a peer changes it.
  const targetEdges = useMemo(
    () => (targetBoardId ? snapshot.edges.filter((edge) => edge.boardId === targetBoardId) : []),
    [snapshot.edges, targetBoardId],
  );
  const model = useMemo(
    // Links ride the same anchor rules the canvas uses, so the picture cannot
    // disagree with the board it depicts.
    () =>
      boardMiniature(targetSections, targetPlacements, {
        edges: targetEdges,
        cards: snapshot.cards,
      }),
    [targetSections, targetPlacements, targetEdges, snapshot.cards],
  );

  const peers = useBoardPeers(targetBoardId);
  const dots = useMemo(() => miniatureDots(model, peers), [model, peers]);
  const peerUsers = useMemo(
    () =>
      peers
        .filter(
          (peer, index) => peers.findIndex((entry) => entry.user.name === peer.user.name) === index,
        )
        .map((peer) => peer.user),
    [peers],
  );

  const cardRef = useRef<HTMLDivElement | null>(null);
  const open = useCallback(() => {
    if (!targetBoardId || !board) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    requestPortalEntry({
      nodeId: id,
      targetBoardId,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  }, [board, id, requestPortalEntry, targetBoardId]);

  // A portal is a card, so it carries the same connectors and gestures a note
  // does; the dots live on the node's own box, above the miniatures chrome.
  const connectors = useNodeConnectorWiring(card, placement.boardId);

  // A portal folds like a note: the same store flag, so the state persists per card and a
  // board that reopens remembers which doors were rolled up.
  const collapsed = useUiStore((state) => state.collapsedCards[id] === true);
  const toggleCardCollapsed = useUiStore((state) => state.toggleCardCollapsed);
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null);
  const lastResizeSent = useRef(0);

  const handleResize = useCallback(
    (_event: unknown, params: ResizeParams) => {
      setLiveSize({ width: params.width, height: params.height });
      const now = performance.now();
      if (now - lastResizeSent.current < 40) return;
      lastResizeSent.current = now;
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

  const peerResize = peers.find((peer) => peer.resizing?.nodeId === id)?.resizing ?? null;
  const peerSize = useSmoothedSize(
    peerResize ? { width: peerResize.width, height: peerResize.height } : null,
  );

  const width = liveSize?.width ?? peerSize?.width ?? placement.width ?? null;
  const height = liveSize?.height ?? peerSize?.height ?? placement.height ?? null;
  // A folded portal is a title bar: the shell shrinks with it, or the board keeps a
  // 256px hole where a rolled-up card should be. React Flow re-measures on the change, so
  // the connector dots land on the bar rather than where the frame used to be.
  const shellHeight = collapsed ? PORTAL_HEADER_HEIGHT : (height ?? DEFAULT_PORTAL_SIZE.height);

  return (
    <div
      ref={cardRef}
      data-connector-surface="true"
      className="portal-node-shell"
      style={{
        position: "relative",
        width: width ?? DEFAULT_PORTAL_SIZE.width,
        height: shellHeight,
      }}
    >
      <NodeResizer
        isVisible={canEditLayout && Boolean(selected)}
        minWidth={200}
        minHeight={150}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        lineStyle={{ borderColor: "var(--ink-muted)", borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: "var(--ink)" }}
      />
      <PortalCard
        boardName={board?.name ?? null}
        collapsed={collapsed}
        onToggleCollapsed={canEditLayout ? () => toggleCardCollapsed(id) : undefined}
        height={collapsed ? PORTAL_HEADER_HEIGHT : height}
        glyph={type.glyph || "\u25c9"}
        icon={card ? cardIcon(card, type.icon) : null}
        model={model}
        dots={dots}
        cover={cover}
        peers={peerUsers}
        selected={Boolean(selected)}
        width={width}
        style={card.style}
        onOpen={open}
        onOpenInfo={() => openContainerInspector({ kind: "portal", id })}
      />
      <NodeConnectors {...connectors} selected={Boolean(selected)} />
    </div>
  );
}

export const portalNodeTypes = { portal: PortalNode } satisfies NodeTypes;
