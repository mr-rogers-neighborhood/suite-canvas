import { useCallback, useMemo } from "react";
import { orderedSelection } from "../canvas/interactions/multiSelect";
import { childrenFromLinks, planRadial } from "../canvas/interactions/radialLayout";
import { redoWithStack, undoWithStack } from "../history/undoWithStack";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * The rows on the palette that act on the document rather than on a surface.
 *
 * `edit.undo`, `edit.redo` and `layout.arrangeRadial` live in the registry but
 * appear only while the shell supplies a handler, so the palette and the dock
 * cannot disagree about what can run. The board's own menu reaches the same
 * functions — `useBoardCommands` plans a radial layout with `planRadial` and
 * `childrenFromLinks`, and the dock's undo pair calls the document's undo
 * manager — so this hook repeats the wiring, never the planning.
 */
export interface BoardPaletteActions {
  /** One structure step back, with the selection cleared of what just moved. */
  undo: () => void;
  redo: () => void;
  /** Arranges the selected card and its links on rings (ADR-0049). */
  arrangeRadial: () => void;
  /** Opens the install panel for the blueprint a card's title and body declare. */
  installBlueprint: (cardId: string) => void;
}

export function useBoardPaletteActions(): BoardPaletteActions {
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const canEditLayout = useUiStore((state) => state.canEditLayout);

  /** Live cards on this board in paint order: the order a selection reads in. */
  const boardOrder = useMemo(() => {
    if (!activeBoardId) return [];
    const live = new Set(snapshot.cards.filter((card) => !card.deletedAt).map((card) => card.id));
    return snapshot.placements
      .filter((placement) => placement.boardId === activeBoardId && live.has(placement.cardId))
      .sort(
        (left, right) =>
          left.z - right.z ||
          left.createdAt - right.createdAt ||
          left.cardId.localeCompare(right.cardId),
      )
      .map((placement) => placement.cardId);
  }, [snapshot.cards, snapshot.placements, activeBoardId]);

  const step = useCallback(
    (direction: "undo" | "redo") => {
      if (direction === "undo") undoWithStack(workspace);
      else redoWithStack(workspace);
      // A card that just disappeared must not stay selected or under the caret.
      const ui = useUiStore.getState();
      ui.setSelectedNodeIds([]);
      ui.stopEditing();
    },
    [workspace],
  );

  const undo = useCallback(() => step("undo"), [step]);
  const redo = useCallback(() => step("redo"), [step]);

  const arrangeRadial = useCallback(() => {
    if (!canEditLayout || !activeBoardId) return;
    const [rootCardId] = orderedSelection(boardOrder, selectedNodeIds);
    if (!rootCardId) return;
    const plan = planRadial({
      boardId: activeBoardId,
      rootCardId,
      children: childrenFromLinks({
        boardId: activeBoardId,
        edges: snapshot.edges,
        references: snapshot.references,
      }),
      placements: snapshot.placements,
      sections: snapshot.sections.filter((section) => section.boardId === activeBoardId),
    });
    if (!plan) return;
    workspace.applyLayoutPlan(plan, { origin: "layout:mindmap" });
  }, [
    canEditLayout,
    activeBoardId,
    boardOrder,
    selectedNodeIds,
    snapshot.edges,
    snapshot.references,
    snapshot.placements,
    snapshot.sections,
    workspace,
  ]);

  const installBlueprint = useCallback((cardId: string) => {
    useUiStore.getState().openBlueprintInstall(cardId);
  }, []);

  return useMemo(
    () => ({ undo, redo, arrangeRadial, installBlueprint }),
    [undo, redo, arrangeRadial, installBlueprint],
  );
}
