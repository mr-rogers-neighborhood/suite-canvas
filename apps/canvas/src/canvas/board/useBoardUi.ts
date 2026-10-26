import { useReactFlow, useStoreApi } from "@xyflow/react";
import { usePresenceStore } from "../../collab/usePresenceStore";
import { usePublishAxes } from "../../collab/usePublishAxes";
import { useBoardPeers } from "../../hooks/useBoardPeers";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useUiStore } from "../../store/useUiStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";
import { useAppearanceStore } from "../../theme/useAppearanceStore";
import { useSurfaceRules } from "../rules";
import { useCanvasLens, useLensReferenceRepair } from "../useCanvasLens";

/**
 * Everything the board reads from a store, the camera or a reader preference,
 * gathered once. The board's own hooks take this bundle instead of reaching for
 * a store themselves; document truth still arrives through the snapshot.
 */
export function useBoardUi() {
  const snapshot = useWorkspaceSnapshot();
  const lens = useCanvasLens();
  useLensReferenceRepair(lens.view !== null);
  const workspace = useCanvasStore((state) => state.workspace);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const peers = useBoardPeers(activeBoardId);
  usePublishAxes();

  const setPointer = usePresenceStore((state) => state.setPointer);
  const setDragging = usePresenceStore((state) => state.setDragging);
  const setPresenceSelection = usePresenceStore((state) => state.setSelection);
  const setSelectionBox = usePresenceStore((state) => state.setSelectionBox);
  const setReconnect = usePresenceStore((state) => state.setReconnect);
  const setConnect = usePresenceStore((state) => state.setConnect);
  const setSectionDragPresence = usePresenceStore((state) => state.setSectionDrag);
  const setSectionResizePresence = usePresenceStore((state) => state.setSectionResize);
  const setLabelDrag = usePresenceStore((state) => state.setLabelDrag);

  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const selectedSectionId = useUiStore((state) => state.selectedSectionId);
  const presenting = useUiStore((state) => Boolean(state.tour?.presenting));
  const selectSection = useUiStore((state) => state.selectSection);
  const editingSectionId = useUiStore((state) => state.editingSectionId);
  const setEditingSection = useUiStore((state) => state.setEditingSection);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const selectedEdgeIds = useUiStore((state) => state.selectedEdgeIds);
  const setSelectedEdgeIds = useUiStore((state) => state.setSelectedEdgeIds);
  const startEditing = useUiStore((state) => state.startEditing);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const setLinkingInProgress = useUiStore((state) => state.setLinkingInProgress);
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);
  const stopEditing = useUiStore((state) => state.stopEditing);
  const contextMenu = useUiStore((state) => state.contextMenu);

  // The reader's default radius, the rung a card falls back to when its own style and the
  // workspace rules name none. Read here so a link anchor can resolve the same number the
  // card face paints with.
  const readerRadius = useAppearanceStore((state) => state.appearance.radius);
  const surfaceRules = useSurfaceRules();

  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canCreateContent = useUiStore((state) => state.canCreateContent);
  const canCreateBoards = useUiStore((state) => state.canCreateBoards);
  const canManageTrash = useUiStore((state) => state.canManageTrash);
  const canManageLinks = useUiStore((state) => state.canManageLinks);
  const requestShare = useUiStore((state) => state.requestShare);
  // Sections and connectors are workspace structure, not draft objects, so
  // removing one follows the trash row of the matrix: owner and workspace
  // editor tokens only, never a board or card draft.
  const canManageStructure = canManageTrash;

  const setActiveBoardId = useUiStore((state) => state.setActiveBoardId);
  const focusTarget = useUiStore((state) => state.focusTarget);
  const clearFocusTarget = useUiStore((state) => state.clearFocusTarget);
  const { screenToFlowPosition, setViewport, getViewport, fitView } = useReactFlow();
  const store = useStoreApi();

  const requestPortalEntry = useUiStore((state) => state.requestPortalEntry);
  const recordBoardViewport = useUiStore((state) => state.recordBoardViewport);
  const goBackBoard = useUiStore((state) => state.goBackBoard);
  const viewportRequest = useUiStore((state) => state.viewportRequest);
  const clearViewportRequest = useUiStore((state) => state.clearViewportRequest);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const portalOpenRequest = useUiStore((state) => state.portalOpenRequest);
  const clearPortalOpenRequest = useUiStore((state) => state.clearPortalOpenRequest);

  return {
    snapshot,
    lens,
    workspace,
    activeBoardId,
    peers,
    setPointer,
    setDragging,
    setPresenceSelection,
    setSelectionBox,
    setReconnect,
    setConnect,
    setSectionDragPresence,
    setSectionResizePresence,
    setLabelDrag,
    selectedNodeIds,
    selectedConnector,
    selectedSectionId,
    presenting,
    selectSection,
    editingSectionId,
    setEditingSection,
    setSelectedNodeIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    startEditing,
    setSelectedConnector,
    setLinkingInProgress,
    mode,
    setMode,
    openContextMenu,
    closeContextMenu,
    stopEditing,
    contextMenu,
    readerRadius,
    surfaceRules,
    canEditContent,
    canEditLayout,
    canCreateContent,
    canCreateBoards,
    canManageTrash,
    canManageLinks,
    requestShare,
    canManageStructure,
    setActiveBoardId,
    focusTarget,
    clearFocusTarget,
    screenToFlowPosition,
    setViewport,
    getViewport,
    fitView,
    store,
    requestPortalEntry,
    recordBoardViewport,
    goBackBoard,
    viewportRequest,
    clearViewportRequest,
    openCardFocus,
    portalOpenRequest,
    clearPortalOpenRequest,
  };
}
