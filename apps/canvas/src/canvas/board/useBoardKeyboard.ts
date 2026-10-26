import { useEffect } from "react";
import { portalTargetId } from "../../cards/portal";
import { useUiStore } from "../../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../interactions/multiSelect";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardUi } from "./useBoardUi";

/**
 * The board's keys: quick capture, the Escape ladder, curated undo, select-all,
 * delete/unplace and open. The window listener is the only place a key is read,
 * so a surface never has to guess which layer owns it.
 */
export function useBoardKeyboard(
  ui: ReturnType<typeof useBoardUi>,
  input: {
    projection: ReturnType<typeof useBoardProjection>;
    refs: { boardCardIds: { current: string[] } };
    createNoteAt: (position: { x: number; y: number }) => void;
    createSectionAt: (position: { x: number; y: number }, wrapSelection?: boolean) => void;
    enterPortal: (nodeId: string, targetBoardId: string) => void;
    trashSelected: () => void;
    unplaceSelected: () => void;
  },
) {
  const {
    workspace,
    activeBoardId,
    store,
    screenToFlowPosition,
    canCreateContent,
    canEditContent,
    canEditLayout,
    canManageTrash,
    canManageStructure,
    goBackBoard,
  } = ui;
  const { projection, refs } = input;
  const { boardCardIds } = refs;
  const { cardsById } = projection;
  const { createNoteAt, createSectionAt, enterPortal, trashSelected, unplaceSelected } = input;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const state = useUiStore.getState();

      // Quick capture: Cmd/Ctrl+Enter adds a card at the viewport centre and
      // opens its title. A text surface keeps the browser's own chord, so the
      // shortcut never steals a key inside an editor body or a field.
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        !isTyping &&
        !(target instanceof HTMLElement && target.closest(".ProseMirror"))
      ) {
        if (!canCreateContent || !activeBoardId) return;
        event.preventDefault();
        const centre = screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        // Place the card's centre, not its top-left corner, under the cursor.
        createNoteAt({
          x: centre.x - DEFAULT_CARD_WIDTH / 2,
          y: centre.y - DEFAULT_CARD_HEIGHT / 2,
        });
        return;
      }

      // A held run and an armed thread are layers (`useEscapeLayer` above), not
      // branches here: they start after the surface they stand over, and Escape
      // has to end the most recently started thing.
      if (event.key === "Escape" && state.editingSectionId) {
        state.setEditingSection(null);
        return;
      }

      if (event.key === "Escape" && state.selectedSectionId) {
        state.selectSection(null);
        state.closeContainerInspector();
        return;
      }

      if (event.key === "Escape" && state.containerInspector) {
        state.closeContainerInspector();
        return;
      }

      // Focus is a mode of its own: Escape leaves it (and stops its editing)
      // before the card-level or selection-level branches see the key.
      if (event.key === "Escape" && state.cardFocusId) {
        state.closeCardFocus();
        return;
      }

      if (event.key === "Escape" && state.editingNodeId) {
        state.stopEditing();
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      if (event.key === "Escape" && state.focusTarget) {
        state.clearFocusTarget();
        return;
      }

      // A board entered through a portal is a doorway: Escape steps back to the
      // exact board and viewport it was entered from.
      if (event.key === "Escape" && state.boardHistory.at(-1)?.via === "portal") {
        goBackBoard();
        return;
      }

      // Last of the Escape branches: drop the selection once nothing more
      // specific (a rename, an editing card, a pending reveal) owns Escape.
      if (
        event.key === "Escape" &&
        (state.selectedNodeIds.length > 0 ||
          state.selectedEdgeIds.length > 0 ||
          state.selectedConnector)
      ) {
        store.getState().unselectNodesAndEdges();
        state.setSelectedNodeIds([]);
        state.setSelectedEdgeIds([]);
        state.setSelectedConnector(null);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !isTyping) {
        const key = event.key.toLowerCase();
        // Inside a card the editor owns undo (per-fragment history); here it
        // covers structure: moves, links, connectors, place and trash.
        if (key === "z" || key === "y") {
          event.preventDefault();
          if (!canEditContent && !canEditLayout) return;
          if (key === "z" && !event.shiftKey) workspace.undo();
          else workspace.redo();
          state.setSelectedNodeIds([]);
          state.stopEditing();
          return;
        }

        if (key === "g" && canCreateContent) {
          event.preventDefault();
          const centre = screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
          createSectionAt({ x: centre.x - 180, y: centre.y - 130 }, true);
          return;
        }

        // Select every card on the board, never the page text.
        if (key === "a" && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          const ids = boardCardIds.current;
          const flow = store.getState();
          flow.unselectNodesAndEdges();
          flow.addSelectedNodes(ids);
          state.selectAllOnBoard(ids);
          return;
        }
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (isTyping) return;
        // Selected links go first: they are edges, not entities, and nothing else
        // is left dangling by removing one.
        if (state.selectedEdgeIds.length > 0 && canManageStructure) {
          event.preventDefault();
          for (const edgeId of state.selectedEdgeIds) workspace.removeEdge(edgeId);
          state.setSelectedEdgeIds([]);
          return;
        }
        if (state.selectedSectionId) {
          // Sections are workspace structure: an editor may change them, not delete them.
          if (!canManageStructure) return;
          event.preventDefault();
          workspace.deleteSection(state.selectedSectionId);
          state.selectSection(null);
          return;
        }
        if (state.selectedNodeIds.length === 0) return;
        if (!canManageTrash && !canEditLayout) return;
        event.preventDefault();
        // Shift is the explicit trash gesture and stays owner-only. A share
        // editor's Delete unplaces, which is the only destructive act it owns.
        if (event.shiftKey && canManageTrash) trashSelected();
        else if (canEditLayout) unplaceSelected();
        return;
      }

      if (event.key === "Enter" && !isTyping && !state.editingNodeId) {
        const first = state.selectedNodeIds[0];
        if (!first) return;
        // A selected portal is a doorway even for a viewer: navigating is not
        // an edit. Any other card opens its body editor.
        const targetBoardId = portalTargetId(cardsById.get(first));
        if (targetBoardId) {
          event.preventDefault();
          enterPortal(first, targetBoardId);
          return;
        }
        if (!canEditContent) return;
        event.preventDefault();
        state.startEditing(first, "body");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    trashSelected,
    unplaceSelected,
    workspace,
    createSectionAt,
    createNoteAt,
    screenToFlowPosition,
    store,
    activeBoardId,
    canCreateContent,
    canEditContent,
    canEditLayout,
    canManageTrash,
    canManageStructure,
    goBackBoard,
    enterPortal,
    cardsById,
    boardCardIds.current,
  ]);
}
