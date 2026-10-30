import {
  type Card,
  type CardType,
  isBehaviourType,
  isTutorialType,
  type Placement,
} from "@suite/graph";
import {
  type NodeProps,
  NodeResizer,
  type NodeTypes,
  type ResizeParams,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardMeta } from "../cards/cardMeta";
import { NodeCard } from "../cards/NodeCard";
import { hasTourSteps } from "../cards/tour";
import type { PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { countRender } from "../dev/perf";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCardContainers } from "../hooks/useCardContainers";
import { useReferenceCount } from "../hooks/useReferenceCounts";
import { useSmoothedSize } from "../hooks/useSmoothedSize";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useBoards } from "../store/workspaceStore";
import { commitCardResize } from "./board/cardResize";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./interactions/multiSelect";
import { COLLAPSED_CARD_HEIGHT } from "./nodeData";
import { useNodeConnectorWiring } from "./useNodeConnectorWiring";

/**
 * A duplicate lands down-right of its source, like a paper copy. The offset is
 * a tenth of the card box rather than a fixed number of pixels: at the default
 * size a copy must step clear of the original, and at a small zoom a fixed 24
 * put it almost exactly on top, so a click aimed at the copy hit the original.
 */
const DUPLICATE_OFFSET = { x: DEFAULT_CARD_WIDTH / 10, y: DEFAULT_CARD_HEIGHT / 10 };

export function NoteNode({ id, data, selected }: NodeProps) {
  countRender("note");

  const { card, placement, type, meta, dim, collapsed } = data as {
    card: Card;
    placement: Placement;
    type: CardType;
    meta: CardMeta;
    dim?: boolean;
    collapsed?: boolean;
  };
  const workspace = useCanvasStore((state) => state.workspace);
  const cursorStore = useCanvasStore((state) => state.cursors);
  const boards = useBoards();
  const peers = useBoardPeers(placement.boardId);
  const localUser = usePresenceStore((state) => state.localUser);
  const setResizing = usePresenceStore((state) => state.setResizing);

  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const startEditing = useUiStore((state) => state.startEditing);
  const interactionMode = useUiStore((state) => state.interactionMode);
  const locked = interactionMode === "locked";
  const stopEditing = useUiStore((state) => state.stopEditing);
  const openInspector = useUiStore((state) => state.openInspector);
  const openTypeMenu = useUiStore((state) => state.openTypeMenu);
  const canCreateContent = useUiStore((state) => state.canCreateContent);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canManageTrash = useUiStore((state) => state.canManageTrash);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const metaExpanded = useUiStore((state) => Boolean(state.expandedCardMeta[id]));
  const toggleCardMeta = useUiStore((state) => state.toggleCardMeta);
  const toggleCardCollapsed = useUiStore((state) => state.toggleCardCollapsed);

  // Container ids are stable; resolving them through the container observer
  // lets a card that mounted before the body existed adopt it without
  // subscribing to every other card on the board.
  const containers = useCardContainers(id);
  // A number, not the snapshot: the header chip only re-renders when it moves.
  const linkCount = useReferenceCount(id);
  const contentId = useMemo(
    () => containers.contentId ?? workspace.peekContent(id)?.id,
    [workspace, id, containers],
  );
  const titleId = useMemo(
    () => containers.titleId ?? workspace.peekTitle(id)?.id,
    [workspace, id, containers],
  );

  const editing = editingNodeId === id && editingSurface === "canvas" ? editingField : null;

  // Allocate text containers on-demand when entering edit mode if they do not yet exist
  useEffect(() => {
    if (editing === "body" && !contentId) {
      workspace.getContent(id);
    } else if (editing === "title" && !titleId) {
      workspace.getTitle(id);
    }
  }, [editing, contentId, titleId, workspace, id]);

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

  const selectingPeers = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.selection?.nodeIds.includes(id)).map((peer) => peer.user),
    [peers, id],
  );

  const resizingPeers = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.resizing?.nodeId === id).map((peer) => peer.user),
    [peers, id],
  );
  // One wiring for every node kind: the same dots, gestures and peer rings a
  // portal or a sketch gets.
  const connectors = useNodeConnectorWiring(card, placement.boardId);

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

  const { getNodes } = useReactFlow();

  const handleResizeEnd = useCallback(
    (_event: unknown, params: ResizeParams) => {
      const collapsedCards = useUiStore.getState().collapsedCards;
      const cardSizes = new Map<string, { width: number; height: number }>();
      for (const n of getNodes()) {
        const isCollapsed = collapsedCards[n.id] === true;
        const w = n.measured?.width ?? n.width;
        const h = isCollapsed ? COLLAPSED_CARD_HEIGHT : (n.measured?.height ?? n.height);
        if (w !== undefined && h !== undefined) cardSizes.set(n.id, { width: w, height: h });
      }
      commitCardResize(
        workspace,
        placement.boardId,
        id,
        {
          x: params.x,
          y: params.y,
          width: params.width,
          height: params.height,
        },
        cardSizes,
      );
      setResizing(null);
      setLiveSize(null);
    },
    [workspace, placement.boardId, id, setResizing, getNodes],
  );

  const panelOwnsCard = editingNodeId === id && editingSurface === "panel";
  const width = liveSize?.width ?? peerSize?.width ?? placement.width ?? null;
  // A fold wins over every measured size: the card is its header line, and the
  // placement keeps the height it had so unfolding restores it.
  const height =
    collapsed === true
      ? COLLAPSED_CARD_HEIGHT
      : (liveSize?.height ?? peerSize?.height ?? placement.height ?? null);

  // Duplicating is creating content, moving is a placement change; the menu
  // only ever receives the callbacks this session's capabilities allow.
  const duplicate = useCallback(() => {
    const copy = workspace.duplicateCard(id, {
      boardId: placement.boardId,
      offset: DUPLICATE_OFFSET,
    });
    setSelectedNodeIds([copy.id]);
  }, [workspace, id, placement.boardId, setSelectedNodeIds]);

  const moveToBoard = useCallback(
    (boardId: string) => {
      workspace.moveCardToBoard(id, boardId);
      setSelectedNodeIds([]);
      stopEditing();
    },
    [workspace, id, setSelectedNodeIds, stopEditing],
  );

  /**
   * What this card can become.
   *
   * A behaviour type is drawn by the runtime — a sketch is a drawing surface, a portal is a
   * door — so it is neither a target nor a starting point: converting a note into a sketch
   * would produce a card the canvas has no renderer for, and converting a sketch into a
   * note would throw away the drawing. Both lists are the same list, so the menu simply
   * offers nothing for a behaviour card (ADR-0040).
   */
  const typeTargets = useMemo(() => {
    // A behaviour card is the runtime's: it has no siblings to become.
    if (isBehaviourType(type.id) || card.typeIds.some((entry) => isBehaviourType(entry))) return [];
    return workspace
      .listTypes()
      .filter((entry) => entry.name.length > 0 && !isBehaviourType(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.name }));
  }, [workspace, type.id, card.typeIds]);
  const moveTargets = useMemo(
    () =>
      boards
        .filter((board) => board.id !== placement.boardId)
        .map((board) => ({ id: board.id, name: board.name })),
    [boards, placement.boardId],
  );

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
        dim={dim === true}
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
        collapsed={collapsed === true}
        onToggleCollapsed={() => toggleCardCollapsed(id)}
        selected={selected}
        editing={editing}
        presence={presence}
        draggingPeers={draggingPeers}
        showDragLabel={!draggingGroup}
        selectingPeers={selectingPeers}
        resizingPeers={resizingPeers}
        chaining={connectors.chaining}
        draftActive={connectors.draftActive}
        armed={connectors.armed}
        armedConnectorId={connectors.armedConnectorId}
        movingConnectorPeers={connectors.movingConnectorPeers}
        selectingConnectorPeers={connectors.selectingConnectorPeers}
        canEditContent={canEditContent}
        canEditLayout={canEditLayout}
        canManageTrash={canManageTrash}
        onStartEditing={(field) => {
          if (locked) return;
          if (field === "body" && !contentId) {
            workspace.getContent(id);
          } else if (field === "title" && !titleId) {
            workspace.getTitle(id);
          }
          startEditing(id, field, "canvas");
        }}
        onEditEnd={stopEditing}
        {...(canEditLayout
          ? { onRemoveFromBoard: () => workspace.unplaceCard(placement.boardId, id) }
          : {})}
        linkCount={linkCount}
        onOpenInfo={() => openInspector(id)}
        interactionMode={interactionMode}
        onOpenTypeMenu={(anchor) => openTypeMenu(id, anchor)}
        typeTargets={typeTargets}
        {...(canEditContent
          ? {
              onSetType: (typeId: string) => workspace.setCardTypes(id, [typeId], typeId),
            }
          : {})}
        presentable={isTutorialType(type) || hasTourSteps(workspace.doc, contentId ?? null)}
        // A tour is the way into a presentation: double-click it to play it
        // (ADR-0064 §11). Reading the store here matches `openCardFocus` beside it.
        onDoubleClickPresent={() => {
          // Two ways a card is a tour (ADR-0054 §1): it is typed Tutorial, or its
          // body already holds step blocks. Asked at click time, not render time,
          // so a step typed a second ago already counts.
          if (!isTutorialType(type) && !hasTourSteps(workspace.doc, contentId ?? null))
            return false;
          useUiStore.getState().presentTour(id);
          return true;
        }}
        onFocusCard={() => useUiStore.getState().openCardFocus(id)}
        {...(canCreateContent ? { onDuplicate: duplicate } : {})}
        {...(canEditLayout ? { moveTargets, onMoveToBoard: moveToBoard } : {})}
        {...(canManageTrash ? { onTrash: () => workspace.trashCard(id) } : {})}
        onConnectorMoveStart={connectors.onMoveStart}
        onConnectorMove={connectors.onMove}
        onConnectorMoveFinished={connectors.onMoveFinished}
        selectedConnectorId={connectors.selectedConnectorId}
        onConnectorSelect={connectors.onSelect}
        onConnectorMoveEnd={connectors.onMoveEnd}
        onConnectorContextMenu={connectors.onContextMenu}
      />
    </div>
  );
}

export const nodeTypes = { note: NoteNode } satisfies NodeTypes;
