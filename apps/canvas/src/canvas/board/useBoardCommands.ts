import {
  DEFAULT_REFLOW_CARD_HEIGHT,
  DEFAULT_REFLOW_CARD_WIDTH,
  type LayerAction,
  proposeReflowPlan,
} from "@suite/graph";
import type { Node } from "@xyflow/react";
import { useCallback } from "react";
import { ensureViewType, VIEW_TYPE_ID } from "../../cards/viewCard";
import { ensureWhiteboardType } from "../../cards/whiteboard";
import { openMediaPickerOnBoard } from "../../editor/mediaPicker";
import { clipboardFrom } from "../../entities/clipboard";
import { type ColourSelection, colourPlan, colourPlanIsEmpty } from "../../entities/colour";
import { useUiStore } from "../../store/useUiStore";
import { useViewsStore } from "../../store/viewsStore";
import { installBlueprintCard } from "../blueprints/blueprint";
import {
  type AlignEdge,
  type DistributeAxis,
  planAlign,
  planDistribute,
} from "../interactions/arrangeCommand";
import { dragMoves, dragRects, layerActions, orderedSelection } from "../interactions/multiSelect";
import { childrenFromLinks, planRadial } from "../interactions/radialLayout";
import { COLLAPSED_CARD_HEIGHT } from "../nodeData";
import { portalSizeForBounds } from "../PortalCard";
import { boardBounds } from "../portalMiniature";
import { sectionsExpandPlan } from "../sections/sectionLayout";
import { writeSelectionColour } from "./selectionColour";
import { dragDelta, mergeSectionWrites, selectionDragPlan } from "./selectionDrag";
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
    canManageSchema,
    canManageTrash,
    setSelectedNodeIds,
    setPresenceSelection,
    stopEditing,
    startEditing,
    openCardFocus,
    selectedNodeIds,
  } = ui;
  const { projection } = input;
  const { boardSections, boardEdges, boardPlacementList, boardOrder } = projection;

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

  /**
   * Cut and Copy put the selection aside; Paste makes it again where the pointer is.
   *
   * The clipboard is this tab's (see `entities/clipboard`), and a link only travels when both of its
   * ends do — a join to something that was not copied has nothing to attach to.
   */
  const copySelection = useCallback(() => {
    const state = useUiStore.getState();
    const entry = clipboardFrom({
      cards: state.selectedNodeIds,
      sections: state.selectedSectionIds,
      edges: boardEdges,
      placements: boardPlacementList,
      sectionsById: new Map(boardSections.map((section) => [section.id, section])),
    });
    if (entry) state.setClipboard(entry);
    return entry;
  }, [boardEdges, boardPlacementList, boardSections]);

  const cutSelection = useCallback(() => {
    const state = useUiStore.getState();
    if (!canEditLayout) return;
    const entry = copySelection();
    if (!entry) return;
    // The same removals Delete performs, so a cut and a delete agree about what going away means.
    for (const id of state.selectedEdgeIds) workspace.removeEdge(id);
    for (const sectionId of state.selectedSectionIds) workspace.deleteSection(sectionId);
    for (const id of state.selectedNodeIds) workspace.unplaceCard(activeBoardId ?? "", id);
    state.setSelectedNodeIds([]);
    state.setSelectedEdgeIds([]);
    state.selectSection(null);
    state.stopEditing();
  }, [canEditLayout, copySelection, workspace, activeBoardId]);

  /** A card's own connector layout, so a copied link can name the same dots. */
  const sourceConnectors = useCallback(
    (cardId: string) => snapshot.cards.find((card) => card.id === cardId)?.connectors,
    [snapshot.cards],
  );

  /**
   * Put the clipboard down with its top-left corner at `point`.
   *
   * One offset for the whole group, so a copied arrangement keeps its shape. Sections are re-created
   * first: a duplicated card is placed by the document, and a card whose frame does not exist yet
   * would land outside it. Links are re-made last, between the copies whose both ends were copied.
   */
  const pasteAt = useCallback(
    (point: { x: number; y: number }) => {
      const state = useUiStore.getState();
      const entry = state.clipboard;
      if (!entry || !canCreateContent || !activeBoardId) return;
      const delta = { x: point.x - entry.origin.x, y: point.y - entry.origin.y };

      const sectionIds = new Map<string, string>();
      for (const sectionId of entry.sections) {
        const source = boardSections.find((section) => section.id === sectionId);
        if (!source) continue;
        const copy = workspace.createSection({
          boardId: activeBoardId,
          title: source.title,
          x: source.x + delta.x,
          y: source.y + delta.y,
          width: source.width,
          height: source.height,
          ...(source.color ? { color: source.color } : {}),
        });
        // A frame is more than a rectangle: the icon, the labels and whether it is elastic are all part
        // of what the reader copied.
        if (source.icon !== undefined) workspace.setSectionIcon(copy.id, source.icon);
        if (source.tags.length > 0) workspace.setSectionTags(copy.id, [...source.tags]);
        if (source.shrinkToFit === false) workspace.setSectionShrinkToFit(copy.id, false);
        sectionIds.set(sectionId, copy.id);
      }

      const cardIds = new Map<string, string>();
      for (const cardId of entry.cards) {
        try {
          const connectors = sourceConnectors(cardId);
          const copy = workspace.duplicateCard(cardId, {
            boardId: activeBoardId,
            offset: delta,
            ...(connectors ? { connectors } : {}),
          });
          cardIds.set(cardId, copy.id);
        } catch {
          // A card that was trashed or deleted elsewhere has nothing to copy; the rest still land.
        }
      }

      for (const { edge } of entry.links) {
        const source =
          edge.sourceKind === "section" ? sectionIds.get(edge.source) : cardIds.get(edge.source);
        const target =
          edge.targetKind === "section" ? sectionIds.get(edge.target) : cardIds.get(edge.target);
        if (!source || !target) continue;
        workspace.addEdge({
          boardId: activeBoardId,
          source,
          target,
          ...(edge.sourceKind ? { sourceKind: edge.sourceKind } : {}),
          ...(edge.targetKind ? { targetKind: edge.targetKind } : {}),
          ...(edge.sourceConnector ? { sourceConnector: edge.sourceConnector } : {}),
          ...(edge.targetConnector ? { targetConnector: edge.targetConnector } : {}),
          ...(edge.kind ? { kind: edge.kind } : {}),
        });
      }

      const pasted = [...cardIds.values()];
      if (pasted.length > 0) state.setSelectedNodeIds(pasted);
      const pastedSections = [...sectionIds.values()];
      if (pastedSections.length > 0) state.selectSections(pastedSections);
    },
    [workspace, activeBoardId, canCreateContent, boardSections, sourceConnectors],
  );

  /**
   * The verbs a key or a palette row runs, by the id the verb table gives them.
   *
   * The keyboard used to hold its own branches for these four; naming them here means the id in
   * `menu/verbs.ts`, the id a palette row prints and the code a key runs are one identifier, and a verb
   * that gains a key has one place to gain it.
   */
  const runVerb = useCallback(
    (id: "delete" | "cut" | "copy" | "paste") => {
      switch (id) {
        case "delete":
          unplaceSelected();
          return;
        case "cut":
          cutSelection();
          return;
        case "copy":
          copySelection();
          return;
        case "paste":
          pasteAt(useUiStore.getState().contextMenu?.flowPosition ?? { x: 0, y: 0 });
          return;
      }
    },
    [unplaceSelected, cutSelection, copySelection, pasteAt],
  );

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
    (dragged: Node[], options?: { allowReflow?: boolean }) => {
      if (!canEditLayout || !activeBoardId || dragged.length === 0) return;
      const moves = dragMoves(dragged);
      const selectedSectionIds = useUiStore.getState().selectedSectionIds;

      // The frame the reader boxed travels with the cards. A group move is a rigid translation, so
      // the single-card reflow below is skipped while a section is selected: reflow answers "where
      // does this one card push its neighbours", and that is not the gesture being made.
      const group =
        selectedSectionIds.length === 0
          ? null
          : selectionDragPlan({
              sections: boardSections,
              placements: boardPlacementList,
              selectedSectionIds,
              draggedNodeIds: moves.map((move) => move.cardId),
              delta: dragDelta(moves, boardPlacementList),
            });

      // Single-card drag drops check for propagator-based collision reflow and section breathing
      if (options?.allowReflow && dragged.length === 1 && group === null) {
        const target = dragged[0];
        if (target) {
          const isCollapsed = useUiStore.getState().collapsedCards[target.id] === true;
          const targetSize = {
            width: target.measured?.width ?? target.width ?? DEFAULT_REFLOW_CARD_WIDTH,
            height: isCollapsed
              ? COLLAPSED_CARD_HEIGHT
              : (target.measured?.height ?? target.height ?? DEFAULT_REFLOW_CARD_HEIGHT),
          };
          const lookup = store.getState().nodeLookup;
          const collapsedCards = useUiStore.getState().collapsedCards;
          const cardSizes = new Map<string, { width: number; height: number }>();
          for (const [id, node] of lookup) {
            const nodeCollapsed = collapsedCards[id] === true;
            const w = node.measured?.width ?? node.width;
            const h = nodeCollapsed
              ? COLLAPSED_CARD_HEIGHT
              : (node.measured?.height ?? node.height);
            if (w !== undefined && h !== undefined) {
              cardSizes.set(id, { width: w, height: h });
            }
          }
          const reflowPlan = proposeReflowPlan({
            boardId: activeBoardId,
            targetCardId: target.id,
            targetPosition: target.position,
            targetSize,
            placements: boardPlacementList,
            sections: boardSections,
            cardSizes,
          });
          if (reflowPlan) {
            workspace.applyLayoutPlan(reflowPlan);
            return;
          }
        }
      }

      const grown = sectionsExpandPlan(boardSections, dragRects(dragged));
      if (grown.length > 0 || group !== null) {
        workspace.moveSectionsBatch({
          // A frame can both travel and grow in one drop, so the two lists are merged by id rather
          // than concatenated: two entries for one section would drop half the change.
          sections: mergeSectionWrites(group?.sections ?? [], grown),
          placements: [
            ...moves.map((move) => ({ boardId: activeBoardId, ...move })),
            ...(group?.placements ?? []),
          ],
        });
        return;
      }
      // No section needs to grow or move: `movePlacements` skips no-op moves and stays
      // silent when the whole gesture ended where it started.
      workspace.movePlacements(activeBoardId, moves);
    },
    [activeBoardId, boardPlacementList, boardSections, workspace, canEditLayout, store],
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
      if (nodes.length === 0) {
        // A frame on its own still moves: it is structure the reader selected, even though React Flow
        // has no node for it.
        if (state.selectedSectionIds.length === 0) return;
        const alone = selectionDragPlan({
          sections: boardSections,
          placements: boardPlacementList,
          selectedSectionIds: state.selectedSectionIds,
          draggedNodeIds: [],
          delta: { x: delta.dx, y: delta.dy },
        });
        if (alone.sections.length > 0) {
          workspace.moveSectionsBatch({ sections: alone.sections, placements: alone.placements });
        }
        return;
      }
      commitDrop(nodes);
    },
    [activeBoardId, canEditLayout, commitDrop, store, boardSections, boardPlacementList, workspace],
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

  /**
   * A view card at the click, with the editor open on the view it will present.
   *
   * The card is made first because the reader asked for it where they right-clicked; the view is
   * written on Save, and a cancelled editor takes the card back with it — a cancelled view leaves
   * nothing on the board. `viewsStore.pendingCardId` is that link, and the editor is the only place
   * that reads it.
   */
  const createViewAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !canManageSchema || !activeBoardId) return;
      ensureViewType(workspace);
      const card = workspace.createCard({
        typeId: VIEW_TYPE_ID,
        boardId: activeBoardId,
        position,
      });
      setSelectedNodeIds([card.id]);
      useViewsStore.getState().openNew(workspace.listViews().length, card.id);
    },
    [workspace, activeBoardId, setSelectedNodeIds, canCreateContent, canManageSchema],
  );

  /**
   * A view of what is selected right now.
   *
   * The selection *is* a context, so a view started from it opens as a draft whose pins are those cards:
   * the reader asked "what if this were a view", and the answer is a view that already contains it. It is
   * a draft rather than a record because looking is not yet deciding to keep.
   */
  const createViewFromSelection = useCallback(() => {
    if (!canManageSchema) return;
    const selected = useUiStore.getState().selectedNodeIds;
    const ids = selected.filter((id) => workspace.getCard(id) !== undefined);
    if (ids.length === 0) return;
    useViewsStore.getState().openNew(workspace.listViews().length);
    useViewsStore.getState().setDraft({
      name:
        ids.length === 1
          ? workspace.displayTitle(ids[0] ?? "") || "One card"
          : `${String(ids.length)} cards`,
      cardIds: ids,
    });
  }, [workspace, canManageSchema]);

  /**
   * Media at the click: ask which kind, then make the card that holds it.
   *
   * The picker decides the kind and the target decides where it lands, so this is one call and the same table the
   * `/` menu uses. The card is made after a file is chosen, because a cancelled dialog must not leave an empty card
   * on the board — which is the one place this differs from `New view`, where the card *is* the thing being made.
   */
  const createMediaAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !activeBoardId) return;
      openMediaPickerOnBoard(activeBoardId, position);
    },
    [activeBoardId, canCreateContent],
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

  const alsoPlaceCardOnBoard = useCallback(
    (cardId: string, boardId: string) => {
      if (!canEditLayout) return;
      workspace.alsoPlaceCardOnBoard(cardId, boardId);
    },
    [workspace, canEditLayout],
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

  /**
   * Mind-map mode (ADR-0049), simplified: the selected card is the root and its links
   * and mentions are the branches. One plan, one undo step, no rule left behind that
   * would move a card the reader has since placed by hand.
   */
  const arrangeRadialSelection = useCallback(() => {
    if (!canEditLayout || !activeBoardId) return;
    const [rootCardId] = orderedSelection(boardOrder, selectedNodeIds);
    if (!rootCardId) return;
    const plan = planRadial({
      boardId: activeBoardId,
      rootCardId,
      children: childrenFromLinks({
        boardId: activeBoardId,
        edges: boardEdges,
        references: snapshot.references,
      }),
      placements: boardPlacementList,
      sections: boardSections,
    });
    if (!plan) return;
    workspace.applyLayoutPlan(plan, { origin: "layout:mindmap" });
  }, [
    canEditLayout,
    activeBoardId,
    selectedNodeIds,
    boardOrder,
    boardEdges,
    boardPlacementList,
    boardSections,
    snapshot.references,
    workspace,
  ]);

  /**
   * Installs the selected card as a type blueprint (ADR-0059). The card's title is the type
   * name and its body declares the fields, so one graph call path does the whole install in
   * one undo step. Returns what happened, because a card that is not a blueprint is a real
   * answer the caller may want to say out loud.
   */
  const installBlueprintSelection = useCallback(() => {
    if (!canManageSchema) return null;
    const [cardId] = orderedSelection(boardOrder, selectedNodeIds);
    if (!cardId) return null;
    return installBlueprintCard(workspace, cardId);
  }, [canManageSchema, boardOrder, selectedNodeIds, workspace]);

  /**
   * One colour across the whole selection: cards and portals in their `style.swatch`, links in
   * theirs, frames in their `color`. The palette row is the same one a single card gets, so a
   * reader who right-clicked inside a selection restyles the selection rather than the card the
   * press happened to land on.
   *
   * The batch is what makes it one undo step: every setter defers its own commit to the end of
   * the batch, so undo takes the whole selection back at once. The inspector writes by the same
   * rule in `useStyleDraft`.
   */
  const setSelectionColour = useCallback(
    (swatch: string | null, selection: ColourSelection) => {
      if (!canEditLayout) return;
      const plan = colourPlan(selection);
      if (colourPlanIsEmpty(plan)) return;
      writeSelectionColour(workspace, plan, swatch, projection.cardsById);
    },
    [workspace, canEditLayout, projection.cardsById],
  );

  return {
    setSelectionColour,
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
    createViewAt,
    createViewFromSelection,
    createMediaAt,
    duplicateCards,
    copySelection,
    cutSelection,
    pasteAt,
    runVerb,
    moveCardToBoard,
    alsoPlaceCardOnBoard,
    otherBoards,
    arrangeSelection,
    arrangeRadialSelection,
    installBlueprintSelection,
  };
}
