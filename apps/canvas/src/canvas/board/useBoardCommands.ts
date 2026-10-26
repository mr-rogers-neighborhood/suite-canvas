import type { LayerAction } from "@suite/graph";
import type { Node } from "@xyflow/react";
import { useCallback } from "react";
import { ensureWhiteboardType } from "../../cards/whiteboard";
import { useUiStore } from "../../store/useUiStore";
import {
  type AlignEdge,
  type DistributeAxis,
  planAlign,
  planDistribute,
} from "../interactions/arrangeCommand";
import { dragMoves, dragRects, layerActions, orderedSelection } from "../interactions/multiSelect";
import { portalSizeForBounds } from "../PortalCard";
import { boardBounds } from "../portalMiniature";
import { sectionsExpandPlan } from "../sections/sectionLayout";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardUi } from "./useBoardUi";

/**
 * What a board command does to the document: create, duplicate, move, restack,
 * unplace, trash and arrange. Each callback is one capability check plus the one
 * `WorkspaceDocument` call it needs.
 */
export function useBoardCommands(
  ui: ReturnType<typeof useBoardUi>,
  input: { projection: ReturnType<typeof useBoardProjection> },
) {
  const {
    workspace,
    activeBoardId,
    snapshot,
    store,
    canEditLayout,
    canCreateContent,
    canCreateBoards,
    canManageTrash,
    setSelectedNodeIds,
    setPresenceSelection,
    stopEditing,
    startEditing,
    openCardFocus,
    selectedNodeIds,
  } = ui;
  const { projection } = input;
  const { boardSections, boardPlacementList, boardOrder } = projection;

  const unplaceSelected = useCallback(() => {
    const state = useUiStore.getState();
    if (!canEditLayout || !activeBoardId) return;
    for (const id of state.selectedNodeIds) {
      workspace.unplaceCard(activeBoardId, id);
    }
    state.setSelectedNodeIds([]);
    state.stopEditing();
  }, [workspace, activeBoardId, canEditLayout]);

  const trashSelected = useCallback(() => {
    const state = useUiStore.getState();
    if (!canManageTrash) return;
    for (const id of state.selectedNodeIds) {
      workspace.trashCard(id);
    }
    state.setSelectedNodeIds([]);
    state.stopEditing();
  }, [workspace, canManageTrash]);

  const changeLayer = useCallback(
    (nodeId: string, action: LayerAction) => {
      if (!canEditLayout || !activeBoardId) return;
      workspace.moveLayer(activeBoardId, nodeId, action);
      setSelectedNodeIds([]);
      setPresenceSelection(null);
    },
    [workspace, activeBoardId, setSelectedNodeIds, setPresenceSelection, canEditLayout],
  );

  // A bulk layer change is N single-card moves applied in an order that keeps
  // the selection's relative stacking (see `layerActions`).
  const changeLayerBulk = useCallback(
    (ids: string[], action: LayerAction) => {
      if (!canEditLayout || !activeBoardId) return;
      for (const id of layerActions(orderedSelection(boardOrder, ids), action)) {
        workspace.moveLayer(activeBoardId, id, action);
      }
      store.getState().unselectNodesAndEdges();
      setSelectedNodeIds([]);
      setPresenceSelection(null);
    },
    [
      workspace,
      activeBoardId,
      boardOrder,
      setSelectedNodeIds,
      setPresenceSelection,
      store,
      canEditLayout,
    ],
  );

  const commitDrop = useCallback(
    (dragged: Node[]) => {
      if (!canEditLayout || !activeBoardId || dragged.length === 0) return;
      const moves = dragMoves(dragged);
      const plan = sectionsExpandPlan(boardSections, dragRects(dragged));
      if (plan.length > 0) {
        workspace.moveSectionsBatch({
          sections: plan,
          placements: moves.map((move) => ({ boardId: activeBoardId, ...move })),
        });
        return;
      }
      // No section needs to grow: `movePlacements` skips no-op moves and stays
      // silent when the whole gesture ended where it started.
      workspace.movePlacements(activeBoardId, moves);
    },
    [activeBoardId, boardSections, workspace, canEditLayout],
  );

  /**
   * Arrow-key movement for the selection: one write per press, and the same
   * section growth a drop gets, so nudging a card past its section's edge grows
   * the section instead of quietly leaving the card outside it.
   */
  const nudgeSelected = useCallback(
    (delta: { dx: number; dy: number }) => {
      if (!canEditLayout || !activeBoardId) return;
      const state = useUiStore.getState();
      const nodes = state.selectedNodeIds.flatMap((id) => {
        const node = store.getState().nodeLookup.get(id);
        return node
          ? [
              {
                ...node,
                position: { x: node.position.x + delta.dx, y: node.position.y + delta.dy },
              },
            ]
          : [];
      });
      if (nodes.length === 0) return;
      commitDrop(nodes);
    },
    [activeBoardId, canEditLayout, commitDrop, store],
  );

  const createNoteAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !activeBoardId) return;
      const card = workspace.createCard({ boardId: activeBoardId, position });
      setSelectedNodeIds([card.id]);
      startEditing(card.id, "title");
    },
    [workspace, activeBoardId, setSelectedNodeIds, startEditing, canCreateContent],
  );

  const createWhiteboardAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !activeBoardId) return;
      const type = ensureWhiteboardType(workspace);
      const card = workspace.createCard({ typeId: type.id, boardId: activeBoardId, position });
      setSelectedNodeIds([card.id]);
      openCardFocus(card.id);
    },
    [workspace, activeBoardId, setSelectedNodeIds, canCreateContent, openCardFocus],
  );

  /**
   * A portal is created with its target in one commit (`createPortalCard`), so
   * the new card can never be seen — or undo-stepped into — without a board.
   */
  const createPortalAt = useCallback(
    (position: { x: number; y: number }, targetBoardId: string) => {
      if (!canCreateContent || !activeBoardId) return;
      const card = workspace.createPortalCard({
        boardId: activeBoardId,
        targetBoardId,
        position,
        // Shaped like the board it opens, measured from the same snapshot the
        // miniature draws from, so the card and its picture agree.
        size: portalSizeForBounds(
          boardBounds(
            snapshot.sections.filter((section) => section.boardId === targetBoardId),
            snapshot.placements.filter((placement) => placement.boardId === targetBoardId),
          ),
        ),
      });
      store.getState().unselectNodesAndEdges();
      store.getState().addSelectedNodes([card.id]);
      setSelectedNodeIds([card.id]);
    },
    [workspace, activeBoardId, setSelectedNodeIds, store, canCreateContent, snapshot],
  );

  /** "New board and portal": stay here and open the new board from the card. */
  const createPortalToNewBoard = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !canCreateBoards || !activeBoardId) return;
      const board = workspace.createBoard();
      createPortalAt(position, board.id);
    },
    [workspace, createPortalAt, activeBoardId, canCreateContent, canCreateBoards],
  );

  const duplicateCards = useCallback(
    (ids: string[]) => {
      if (!canCreateContent || !activeBoardId || ids.length === 0) return;
      const copies = ids.flatMap((id, index) => {
        const card = workspace.getCard(id);
        if (!card || card.deletedAt) return [];
        const step = 16 * index;
        return [
          workspace.duplicateCard(id, {
            boardId: activeBoardId,
            offset: { x: 24 + step, y: 24 + step },
          }),
        ];
      });
      if (copies.length === 0) return;
      setSelectedNodeIds(copies.map((copy) => copy.id));
      setPresenceSelection(null);
    },
    [workspace, activeBoardId, canCreateContent, setSelectedNodeIds, setPresenceSelection],
  );

  const moveCardToBoard = useCallback(
    (cardId: string, boardId: string) => {
      if (!canEditLayout) return;
      workspace.moveCardToBoard(cardId, boardId);
      setSelectedNodeIds([]);
      stopEditing();
    },
    [workspace, canEditLayout, setSelectedNodeIds, stopEditing],
  );

  const otherBoards = useCallback(
    (boardId: string | null) =>
      snapshot.boards
        .filter((board) => board.id !== boardId)
        .map((board) => ({ id: board.id, name: board.name })),
    [snapshot.boards],
  );

  /**
   * Arrange is one gesture over a selection: plan pure, then commit the whole plan
   * in one undoable batch. Sections are not arranged; they grow to fit instead.
   */
  const arrangeSelection = useCallback(
    (kind: "align" | "distribute", value: AlignEdge | DistributeAxis) => {
      if (!canEditLayout || !activeBoardId || selectedNodeIds.length === 0) return;
      const target = {
        boardId: activeBoardId,
        placements: boardPlacementList,
        sections: boardSections,
        selectedCardIds: selectedNodeIds,
      };
      const plan =
        kind === "align"
          ? planAlign(target, value as AlignEdge)
          : planDistribute(target, value as DistributeAxis);
      if (!plan) return;
      workspace.applyLayoutPlan(plan);
    },
    [canEditLayout, activeBoardId, selectedNodeIds, boardPlacementList, boardSections, workspace],
  );

  return {
    unplaceSelected,
    trashSelected,
    changeLayer,
    changeLayerBulk,
    commitDrop,
    nudgeSelected,
    createNoteAt,
    createWhiteboardAt,
    createPortalAt,
    createPortalToNewBoard,
    duplicateCards,
    moveCardToBoard,
    otherBoards,
    arrangeSelection,
  };
}
