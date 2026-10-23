/**
 * The canvas context menu on the ICE surface.
 *
 * ICE owns pointer input and picks; the shell owns the menu. This component is
 * the smaller half of that join: the surface's `contextmenu` listener has
 * already turned one pick into a `ContextMenuState` (see `iceContextMenu.ts`),
 * so all that is left here is building the shared entries and rendering the
 * shared panel — the exact menu the scene surface shows, from the exact builder.
 *
 * Every action writes through `WorkspaceDocument` and then asks the surface to
 * reconcile, because the ICE entities are a projection: nothing here touches
 * them directly.
 *
 * Deliberately absent: sections and edges. ICE has no section layer and no edge
 * layer yet, so those menu sections never appear (their targets are never
 * produced by a pick) rather than appearing and doing nothing.
 */
import type { LayerAction, WorkspaceDocument } from "@suite/graph";
import { useCallback } from "react";
import { portalSizeForBounds } from "../canvas/PortalCard";
import { boardBounds } from "../canvas/portalMiniature";
import { useCanvasMenuItems } from "../canvas/useCanvasMenuItems";
import { ensureWhiteboardType } from "../cards/whiteboard";
import { ContextMenu } from "../components/ContextMenu";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { menuTargetFromPick } from "../ice/iceContextMenu";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/** What the surface must do after a menu action has written to the document. */
export interface IceContextMenuActions {
  /** Re-derive the ICE entities from the document. */
  readonly reconcile: () => void;
  /** Open a portal card's board on the canvas. */
  readonly enterPortal: (cardId: string) => void;
}

export interface IceContextMenuProps extends IceContextMenuActions {
  readonly workspace: WorkspaceDocument;
  readonly rootBoardId: string;
  readonly snapshot?: WorkspaceSnapshot | undefined;
  readonly canCreateContent: boolean;
  readonly canCreateBoards: boolean;
  readonly canEditContent: boolean;
  readonly canEditLayout: boolean;
  readonly canManageStructure: boolean;
  readonly canManageTrash: boolean;
  readonly canManageLinks: boolean;
}

export function IceContextMenu({
  workspace,
  rootBoardId,
  snapshot: snapshotProp,
  canCreateContent,
  canCreateBoards,
  canEditContent,
  canEditLayout,
  canManageStructure,
  canManageTrash,
  canManageLinks,
  reconcile,
  enterPortal,
}: IceContextMenuProps) {
  const liveSnapshot = useWorkspaceSnapshot();
  const snapshot = snapshotProp ?? liveSnapshot;
  const contextMenu = useUiStore((state) => state.contextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const selectSection = useUiStore((state) => state.selectSection);
  const setEditingSection = useUiStore((state) => state.setEditingSection);
  const requestShare = useUiStore((state) => state.requestShare);

  /**
   * ICE entities are a projection, so any menu write has to be re-derived. The
   * menu closes after an entry runs (and on dismiss), which makes close the one
   * place that covers every entry — including the ones the shared builder calls
   * on the workspace itself. Reconcile is idempotent, so a dismiss costs one
   * comparison pass and no writes.
   */
  const close = useCallback(() => {
    closeContextMenu();
    reconcile();
  }, [closeContextMenu, reconcile]);

  const createCardAt = useCallback(
    (position: { x: number; y: number }, typeId?: string) => {
      if (!canCreateContent) return;
      const card = workspace.createCard({
        boardId: rootBoardId,
        position,
        ...(typeId === undefined ? {} : { typeId }),
      });
      setSelectedNodeIds([card.id]);
      useUiStore.getState().openInspector(card.id);
    },
    [canCreateContent, rootBoardId, setSelectedNodeIds, workspace],
  );

  const createNoteAt = useCallback(
    (position: { x: number; y: number }) => createCardAt(position),
    [createCardAt],
  );

  const createWhiteboardAt = useCallback(
    (position: { x: number; y: number }) => {
      const type = ensureWhiteboardType(workspace);
      createCardAt(position, type.id);
    },
    [createCardAt, workspace],
  );

  const createPortalAt = useCallback(
    (position: { x: number; y: number }, targetBoardId: string) => {
      if (!canCreateContent) return;
      const cards = snapshot.placements.filter((entry) => entry.boardId === targetBoardId);
      const card = workspace.createPortalCard({
        boardId: rootBoardId,
        targetBoardId,
        position,
        size: portalSizeForBounds(boardBounds([], cards)),
      });
      setSelectedNodeIds([card.id]);
    },
    [canCreateContent, rootBoardId, setSelectedNodeIds, snapshot, workspace],
  );

  const createPortalToNewBoard = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !canCreateBoards) return;
      const board = workspace.createBoard();
      createPortalAt(position, board.id);
    },
    [canCreateBoards, canCreateContent, createPortalAt, workspace],
  );

  const duplicateCards = useCallback(
    (ids: string[]) => {
      if (!canCreateContent) return;
      for (const id of ids) {
        workspace.duplicateCard(id, { boardId: rootBoardId, offset: { x: 24, y: 24 } });
      }
    },
    [canCreateContent, rootBoardId, workspace],
  );

  const moveCardToBoard = useCallback(
    (cardId: string, boardId: string) => {
      if (!canEditLayout) return;
      workspace.moveCardToBoard(cardId, boardId);
      setSelectedNodeIds([]);
    },
    [canEditLayout, setSelectedNodeIds, workspace],
  );

  const unplaceSelected = useCallback(() => {
    if (!canEditLayout) return;
    for (const id of useUiStore.getState().selectedNodeIds) {
      workspace.unplaceCard(rootBoardId, id);
    }
    setSelectedNodeIds([]);
  }, [canEditLayout, rootBoardId, setSelectedNodeIds, workspace]);

  const trashSelected = useCallback(() => {
    if (!canManageTrash) return;
    for (const id of useUiStore.getState().selectedNodeIds) {
      workspace.trashCard(id);
    }
    setSelectedNodeIds([]);
  }, [canManageTrash, setSelectedNodeIds, workspace]);

  const changeLayer = useCallback(
    (nodeId: string, action: LayerAction) => {
      if (!canEditLayout) return;
      workspace.moveLayer(rootBoardId, nodeId, action);
    },
    [canEditLayout, rootBoardId, workspace],
  );

  const changeLayerBulk = useCallback(
    (ids: string[], action: LayerAction) => {
      if (!canEditLayout) return;
      for (const id of ids) workspace.moveLayer(rootBoardId, id, action);
    },
    [canEditLayout, rootBoardId, workspace],
  );

  const items = useCanvasMenuItems({
    contextMenu,
    workspace,
    snapshot,
    activeBoardId: rootBoardId,
    selectedNodeIds,
    // No section layer on ICE: no card belongs to a section, and the section
    // entries never render because a pick never targets one.
    sectionMembershipMap: EMPTY_MEMBERSHIP,
    setSelectedNodeIds,
    setSelectedConnector,
    selectSection,
    setEditingSection,
    canCreateContent,
    canCreateBoards,
    canEditContent,
    canEditLayout,
    canManageStructure,
    canManageTrash,
    canManageLinks,
    createNoteAt,
    createWhiteboardAt,
    createSectionAt: NOOP_POINT,
    createPortalAt,
    createPortalToNewBoard,
    duplicateCards,
    startEdgeDescription: NOOP_EDGE,
    enterPortal,
    moveCardToBoard,
    unplaceSelected,
    trashSelected,
    changeLayer,
    changeLayerBulk,
    requestShare,
    // No section layer and no connector layer on ICE yet: decline the entries
    // rather than offer actions whose result the surface cannot show.
    supportsSections: false,
    supportsConnectors: false,
  });

  if (contextMenu === null) return null;
  return <ContextMenu x={contextMenu.x} y={contextMenu.y} items={items} onClose={close} />;
}

const EMPTY_MEMBERSHIP: ReadonlyMap<string, string> = new Map();
const NOOP_POINT = (_point: { x: number; y: number }, _wrap?: boolean): void => {};
const NOOP_EDGE = (_edgeId: string, _point: { x: number; y: number }): void => {};

/** Re-exported for the surface's own listener, which needs the same mapping. */
export { menuTargetFromPick };
