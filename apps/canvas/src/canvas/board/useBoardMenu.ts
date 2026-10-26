import { useMemo } from "react";
import type { ContextMenuItem } from "../../dialogs/ContextMenu";
import { buildBoardMenu } from "./menu/buildMenu";
import type { useBoardCommands } from "./useBoardCommands";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardSections } from "./useBoardSections";
import type { useBoardUi } from "./useBoardUi";

export function useBoardMenu(
  ui: ReturnType<typeof useBoardUi>,
  input: {
    projection: ReturnType<typeof useBoardProjection>;
    sections: ReturnType<typeof useBoardSections>;
    commands: ReturnType<typeof useBoardCommands>;
    enterPortal: (nodeId: string, targetBoardId: string) => void;
    startEdgeDescription: (edgeId: string, point: { x: number; y: number }) => void;
  },
): ContextMenuItem[] {
  const { contextMenu, snapshot, workspace, store, mode, setMode } = ui;
  const { projection, sections, commands, enterPortal, startEdgeDescription } = input;
  const { cardsById, sectionMembershipMap } = projection;

  return useMemo<ContextMenuItem[]>(() => {
    // Menus are built from what this session may do, so a share never renders
    // an action its publish would reject. A viewer gets no menu at all.
    if (!contextMenu) return [];
    const ctx = {
      menu: contextMenu,
      workspace,
      activeBoardId: ui.activeBoardId,
      boards: snapshot.boards,
      cardsById,
      sectionMembershipMap,
      selectedNodeIds: ui.selectedNodeIds,
      store,
      mode,
      setMode,
      canCreateContent: ui.canCreateContent,
      canEditLayout: ui.canEditLayout,
      canCreateBoards: ui.canCreateBoards,
      canManageTrash: ui.canManageTrash,
      canManageStructure: ui.canManageStructure,
      canManageLinks: ui.canManageLinks,
      requestShare: ui.requestShare,
      createNoteAt: commands.createNoteAt,
      createWhiteboardAt: commands.createWhiteboardAt,
      createSectionAt: sections.createSectionAt,
      createPortalAt: commands.createPortalAt,
      createPortalToNewBoard: commands.createPortalToNewBoard,
      duplicateCards: commands.duplicateCards,
      moveCardToBoard: commands.moveCardToBoard,
      otherBoards: commands.otherBoards,
      changeLayer: commands.changeLayer,
      changeLayerBulk: commands.changeLayerBulk,
      arrangeSelection: commands.arrangeSelection,
      unplaceSelected: commands.unplaceSelected,
      trashSelected: commands.trashSelected,
      startEdgeDescription,
      enterPortal,
      setSelectedNodeIds: ui.setSelectedNodeIds,
      setSelectedConnector: ui.setSelectedConnector,
      setSelectedSectionConnector: sections.setSelectedSectionConnector,
      setEditingSection: ui.setEditingSection,
      selectSection: ui.selectSection,
    };
    return buildBoardMenu(ctx);
  }, [
    contextMenu,
    workspace,
    ui.activeBoardId,
    snapshot.boards,
    cardsById,
    sectionMembershipMap,
    ui.selectedNodeIds,
    store,
    mode,
    setMode,
    ui.canCreateContent,
    ui.canEditLayout,
    ui.canCreateBoards,
    ui.canManageTrash,
    ui.canManageStructure,
    ui.canManageLinks,
    ui.requestShare,
    ui.setSelectedNodeIds,
    ui.setSelectedConnector,
    ui.setEditingSection,
    ui.selectSection,
    commands,
    sections,
    enterPortal,
    startEdgeDescription,
  ]);
}
