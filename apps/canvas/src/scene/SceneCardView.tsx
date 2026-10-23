import type { Card, CardType } from "@suite/graph";
import { type CSSProperties, useCallback, useMemo } from "react";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/multiSelect";
import type { CardMeta } from "../cards/cardMeta";
import { WhiteboardPreview } from "../cards/WhiteboardPreview";
import { isWhiteboardCard } from "../cards/whiteboard";
import type { PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { type ConnectorPeerState, NodeCard } from "../components/NodeCard";
import { countRender } from "../dev/perf";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCardContainers } from "../hooks/useCardContainers";
import { useDrawing } from "../hooks/useDrawing";
import { useReferenceCount } from "../hooks/useReferenceCounts";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useBoards } from "../store/workspaceStore";
import "./sceneCardView.css";

/**
 * A duplicate lands down-right of its source, like a paper copy: the offset is a
 * tenth of the card box so a copy always steps clear of the original, at any
 * zoom. Same rule as the React Flow surface.
 */
const DUPLICATE_OFFSET = { x: DEFAULT_CARD_WIDTH / 10, y: DEFAULT_CARD_HEIGHT / 10 };

export interface SceneCardViewProps {
  /** Canonical card record; the scene layer resolves it from the instance. */
  card: Card;
  /** Resolved primary type, for the glyph and its label. */
  type: CardType;
  /** Read-only property and tag chips for the card face. */
  meta: CardMeta;
  /** Board the instance is placed on; scopes presence and card menus. */
  boardId: string;
  /** Box in the same page units as the instance rect. */
  width?: number | null;
  height?: number | null;
  selected?: boolean;
  className?: string;
  /**
   * Force this face read-only even when the session could edit. A second,
   * non-interactive twin of a card (the ICE `suite.card` screen-space overlay)
   * mounts over a workspace the user may be editing elsewhere; it must never
   * offer an edit gesture or a menu action that writes.
   */
  readOnly?: boolean;
}

/**
 * The live card face of the scene surface: the real `NodeCard` with its Tiptap
 * title and body, its menu, and the connectors drawn around it.
 *
 * The scene layer owns geometry. This component is the card *inside* the box the
 * layer positions: it takes no pointer or drag handlers on its wrapper, keeps no
 * per-frame state, and runs no effect that writes on mount, so mounting a card
 * for a newly full-LOD instance is a pure render. Only ever mount it for
 * instances at the `full` LOD band — the layer's culling and hysteresis are the
 * mounted-editor budget, and there is no second budget here.
 *
 * Hovering, dragging and resizing belong to `SceneLayer`; a card rendered here
 * still owns its own clicks (open info, start editing, connector menus).
 *
 * The ICE surface mounts this same view as a read-only twin of a card in its
 * `suite.card` DOM overlay: same shell, same global CSS, `readOnly` set so the
 * twin offers no editing or menu that would write from two places.
 *
 * Whiteboard cards render a read-only `WhiteboardPreview` with a double-click
 * that opens the existing focus surface, because a drawing has no Tiptap body to
 * mount. `SceneLayer` may keep routing whiteboards to its own preview instead;
 * whichever path runs, only one preview is mounted per instance.
 */
export function SceneCardView({
  card,
  type,
  meta,
  boardId,
  width = null,
  height = null,
  selected = false,
  className,
  readOnly = false,
}: SceneCardViewProps) {
  countRender("scene-card");

  const workspace = useCanvasStore((state) => state.workspace);
  const cursorStore = useCanvasStore((state) => state.cursors);
  const boards = useBoards();
  const peers = useBoardPeers(boardId);
  const localUser = usePresenceStore((state) => state.localUser);
  const setMovingConnector = usePresenceStore((state) => state.setMovingConnector);

  // The session's own flag ORs with the caller's override: a face mounted as a
  // read-only twin (the ICE overlay) is read-only in an editable session too.
  const sessionReadOnly = useUiStore((state) => state.readOnly);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canManageTrash = useUiStore((state) => state.canManageTrash);
  const canCreateContent = useUiStore((state) => state.canCreateContent);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const startEditing = useUiStore((state) => state.startEditing);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const openInspector = useUiStore((state) => state.openInspector);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const metaExpanded = useUiStore((state) => Boolean(state.expandedCardMeta[card.id]));
  const toggleCardMeta = useUiStore((state) => state.toggleCardMeta);

  // A viewer shorthand and the capability matrix are separate gates; the card
  // face only receives the actions both of them allow. A read-only override is
  // the caller's shorthand for this face specifically, so it ORs in here.
  const locked = readOnly || sessionReadOnly;
  const editContent = canEditContent && !locked;
  const editLayout = canEditLayout && !locked;
  const canTrash = canManageTrash && !locked;
  const canCreate = canCreateContent && !locked;
  // Connectors are workspace structure, not draft objects: moving or removing
  // one follows the trash row of the matrix, so a board or card draft cannot.
  const canManageStructure = canTrash;

  // Container ids are stable and resolving them through the observer adopts a
  // body that a peer creates after this instance mounted. Neither id is created
  // here: mounting a card must not write a title or body container into the
  // document, so a card with no containers yet shows a neutral placeholder and
  // re-renders as soon as the container observer reports one.
  const containers = useCardContainers(card.id);
  // A number, not the snapshot: the header chip only re-renders when it moves.
  const linkCount = useReferenceCount(card.id);

  const whiteboard = isWhiteboardCard(card);
  const drawing = useDrawing(whiteboard ? card.id : null);

  const presence = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.focus?.nodeId === card.id).map((peer) => peer.user),
    [peers, card.id],
  );

  const draggingPeers = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.dragging?.nodeId === card.id).map((peer) => peer.user),
    [peers, card.id],
  );

  // A multi-card drag labels its group outline, not the card under the pointer.
  const draggingGroup = useMemo(
    () =>
      peers.some(
        (peer) => peer.dragging?.nodeId === card.id && (peer.dragging.nodeIds?.length ?? 0) > 1,
      ),
    [peers, card.id],
  );

  const movingConnectorPeers = useMemo<Record<string, ConnectorPeerState>>(() => {
    const result: Record<string, ConnectorPeerState> = {};
    for (const peer of peers) {
      const moving = peer.connector;
      if (moving?.nodeId !== card.id) continue;
      const entry = result[moving.connectorId] ?? { users: [], position: null };
      entry.users.push(peer.user);
      entry.position = entry.position ?? moving.position ?? null;
      result[moving.connectorId] = entry;
    }
    return result;
  }, [peers, card.id]);

  const selectingConnectorPeers = useMemo<Record<string, PresenceUser[]>>(() => {
    const result: Record<string, PresenceUser[]> = {};
    for (const peer of peers) {
      const selected = peer.selection?.connector;
      if (selected?.nodeId !== card.id) continue;
      const list = result[selected.connectorId] ?? [];
      list.push(peer.user);
      result[selected.connectorId] = list;
    }
    return result;
  }, [peers, card.id]);

  const selectingPeers = useMemo<PresenceUser[]>(
    () =>
      peers.filter((peer) => peer.selection?.nodeIds.includes(card.id)).map((peer) => peer.user),
    [peers, card.id],
  );

  const resizingPeers = useMemo<PresenceUser[]>(
    () => peers.filter((peer) => peer.resizing?.nodeId === card.id).map((peer) => peer.user),
    [peers, card.id],
  );

  const moveTargets = useMemo(
    () =>
      boards
        .filter((board) => board.id !== boardId)
        .map((board) => ({ id: board.id, name: board.name })),
    [boards, boardId],
  );

  // Duplicating is creating content, moving is a placement change; the card only
  // ever receives the callbacks this session's capabilities allow.
  const duplicate = useCallback(() => {
    const copy = workspace.duplicateCard(card.id, { boardId, offset: DUPLICATE_OFFSET });
    setSelectedNodeIds([copy.id]);
  }, [workspace, card.id, boardId, setSelectedNodeIds]);

  const moveToBoard = useCallback(
    (targetBoardId: string) => {
      workspace.moveCardToBoard(card.id, targetBoardId);
      setSelectedNodeIds([]);
      stopEditing();
    },
    [workspace, card.id, setSelectedNodeIds, stopEditing],
  );

  const openFocus = useCallback(() => {
    useUiStore.getState().openCardFocus(card.id);
  }, [card.id]);

  // The scene layer positions every instance; this is only the box it hands us.
  const boxStyle: CSSProperties = {
    width: width ?? DEFAULT_CARD_WIDTH,
    height: height ?? DEFAULT_CARD_HEIGHT,
  };
  const wrapperClass = ["scene-card-view", className].filter(Boolean).join(" ");

  if (whiteboard) {
    const title = workspace.displayTitle(card.id);
    return (
      <div
        data-testid="scene-card-view"
        data-card-id={card.id}
        data-variant="whiteboard"
        className={wrapperClass}
        style={boxStyle}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the scene layer owns pointer gestures; this face only opens the focus surface on a double click. */}
        <div
          className="scene-card-view__whiteboard"
          onDoubleClick={openFocus}
          data-testid="scene-card-whiteboard"
        >
          <WhiteboardPreview
            elements={drawing?.elements ?? []}
            label={`${title} preview`}
            className="scene-card-view__drawing"
          />
        </div>
      </div>
    );
  }

  if (!containers.contentId || !containers.titleId) {
    return (
      <div
        data-testid="scene-card-view"
        data-card-id={card.id}
        data-variant="pending"
        className={wrapperClass}
        style={boxStyle}
      >
        <div className="scene-card-view__placeholder" data-testid="scene-card-placeholder">
          {workspace.displayTitle(card.id)}
        </div>
      </div>
    );
  }

  const panelOwnsCard = editingNodeId === card.id && editingSurface === "panel";

  return (
    <div
      data-testid="scene-card-view"
      data-card-id={card.id}
      data-variant="card"
      className={wrapperClass}
      style={boxStyle}
    >
      <NodeCard
        card={card}
        type={type}
        meta={meta}
        metaExpanded={metaExpanded}
        onToggleMeta={() => toggleCardMeta(card.id)}
        cardDoc={workspace.doc}
        contentId={containers.contentId}
        titleId={containers.titleId}
        // The panel is the only surface publishing carets for this card while it
        // owns editing; a read-only scene twin must not clear that cursor.
        cursorStore={panelOwnsCard ? null : cursorStore}
        localUser={localUser}
        boardId={boardId}
        width={width}
        height={height}
        selected={selected}
        editing={
          !locked && editingNodeId === card.id && editingSurface === "canvas" ? editingField : null
        }
        presence={presence}
        draggingPeers={draggingPeers}
        showDragLabel={!draggingGroup}
        selectingPeers={selectingPeers}
        resizingPeers={resizingPeers}
        movingConnectorPeers={movingConnectorPeers}
        selectingConnectorPeers={selectingConnectorPeers}
        canEditContent={editContent}
        canEditLayout={editLayout}
        canManageTrash={canTrash}
        showConnectors={false}
        onStartEditing={(field) => startEditing(card.id, field, "canvas")}
        onEditEnd={stopEditing}
        {...(editLayout
          ? { onRemoveFromBoard: () => workspace.unplaceCard(boardId, card.id) }
          : {})}
        linkCount={linkCount}
        onOpenInfo={() => openInspector(card.id)}
        onFocusCard={openFocus}
        {...(canCreate ? { onDuplicate: duplicate } : {})}
        {...(editLayout ? { moveTargets, onMoveToBoard: moveToBoard } : {})}
        {...(canTrash ? { onTrash: () => workspace.trashCard(card.id) } : {})}
        onConnectorMoveStart={(connectorId) => {
          if (!canManageStructure) return;
          setMovingConnector({ nodeId: card.id, connectorId });
        }}
        onConnectorMove={(connectorId, position) => {
          if (!canManageStructure) return;
          setMovingConnector({ nodeId: card.id, connectorId, position });
        }}
        onConnectorMoveFinished={() => setMovingConnector(null)}
        selectedConnectorId={
          selectedConnector?.nodeId === card.id ? selectedConnector.connectorId : null
        }
        onConnectorSelect={(connectorId) => setSelectedConnector({ nodeId: card.id, connectorId })}
        onConnectorMoveEnd={(connectorId, position) => {
          if (!canManageStructure) return;
          workspace.moveConnector(card.id, connectorId, position);
        }}
        onConnectorContextMenu={(event, connectorId) => {
          if (!canManageStructure) return;
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            kind: "connector",
            nodeId: card.id,
            connectorId,
          });
        }}
      />
    </div>
  );
}
