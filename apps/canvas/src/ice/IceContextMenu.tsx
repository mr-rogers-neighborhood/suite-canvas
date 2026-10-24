/**
 * The canvas context menu on the ICE surface — and the one inline editor the
 * menu can open.
 *
 * ICE owns pointer input and picks; the shell owns the menu. This component is
 * the smaller half of that join: the surface's `contextmenu` listener has
 * already turned one pick into a `ContextMenuState` (see `iceContextMenu.ts`),
 * so all that is left here is building the shared entries and rendering the
 * shared panel — the exact menu the scene surface shows, from the exact builder.
 *
 * Every action writes through `WorkspaceDocument` and then asks the surface to
 * reconcile, because the ICE entities are a projection: nothing here touches
 * them directly. The link entries go further and go through the *planners*, so
 * one gesture is one commit and a no-op edit is not a commit at all
 * (`planEdgeLabel`, `planEdgeDelete`).
 *
 * ## Why the description editor lives here
 *
 * A link's description is edited in `EdgeDescriptionInput`, a React component
 * anchored on a client point. Something mounted has to host it, and this is the
 * component that is mounted for the whole session and already owns the link's
 * menu. Both triggers land in the same state: the "Add/Edit description…" row,
 * and a double click on the ink (the gesture dispatches `SUITE_EDGE_LABEL_EVENT`
 * rather than opening a second editor).
 *
 * ## What a `section` menu is here
 *
 * A Board is a container and the document's Section is its legacy reading
 * (ADR-0039), so the shared builder's section branch is the Board menu — hence
 * "Rename board" / "Delete board" (`sectionNoun`) — and its "Select N cards" row
 * counts the Board's own placements (`boardMembership`), not an empty map.
 * Selecting those cards goes through both halves of the selection: the store
 * write the builder makes, and `selectCardsInIce`, so the engine's `Selected`
 * set agrees with the store for the frame that follows.
 *
 * ## The second editor
 *
 * "Rename board" opens `BoardRenameInput` over the Board's name pill. The state
 * is the shell's (`editingSectionId`), the field is mounted here beside the
 * description editor, and the write is one `renameBoard`.
 *
 * Deliberately absent: the section-only entries (a section created on the plane).
 * Connectors are supported end to end — "Add connector" on a card, "Reposition
 * Connector" and "Delete connector" on the dot's own menu (the gesture
 * hit-tests the dot, because ICE's card carries no connector part), and the
 * slide itself: "Reposition Connector" arms the same connector a click on the
 * dot arms, which is what the next press slides.
 */
import type { EdgePath, LayerAction, WorkspaceDocument } from "@suite/graph";
import { useCallback, useEffect, useMemo, useState } from "react";
import { boardSizeForBounds } from "../canvas/boardSize";
import { EdgeDescriptionInput } from "../canvas/EdgeDescriptionInput";
import { boardBounds } from "../canvas/portalMiniature";
import { useCanvasMenuItems } from "../canvas/useCanvasMenuItems";
import { ensureWhiteboardType } from "../cards/whiteboard";
import { ContextMenu } from "../components/ContextMenu";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import {
  applyCanonicalWrite,
  applyEdgeLabelWrite,
  planEdgeDelete,
  planEdgeLabel,
  workspaceWriter,
} from "../ice/iceBridge";
import { boardMembership, menuTargetFromPick } from "../ice/iceContextMenu";
import { edgeLabelRequestOf, SUITE_EDGE_LABEL_EVENT } from "../ice/suiteEdgeLabelLayer";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { BoardRenameInput } from "./BoardRenameInput";
import { selectCardsInIce } from "./iceSelectionCommand";

/** What the surface must do after a menu action has written to the document. */
export interface IceContextMenuActions {
  /** Re-derive the ICE entities from the document. */
  readonly reconcile: () => void;
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
}: IceContextMenuProps) {
  const liveSnapshot = useWorkspaceSnapshot();
  const snapshot = snapshotProp ?? liveSnapshot;
  const contextMenu = useUiStore((state) => state.contextMenu);
  const closeContextMenu = useUiStore((state) => state.closeContextMenu);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const setSelectedEdgeIds = useUiStore((state) => state.setSelectedEdgeIds);
  const selectSection = useUiStore((state) => state.selectSection);
  const setEditingSection = useUiStore((state) => state.setEditingSection);
  const editingSectionId = useUiStore((state) => state.editingSectionId);
  const requestShare = useUiStore((state) => state.requestShare);

  /**
   * The Board's real membership: the Board a card is placed on. This is the map
   * the shared builder counts "Select N cards" from and unplaces through, and
   * ICE used to hand it an empty one — which is why the row always read zero.
   */
  const membership = useMemo(() => boardMembership(snapshot.placements), [snapshot.placements]);

  /**
   * The Board being renamed, read back from the snapshot so the field opens on
   * the current name (a peer may have renamed it since the menu opened).
   */
  const renaming = useMemo(() => {
    if (editingSectionId === null) return null;
    return snapshot.boards.find((board) => board.id === editingSectionId) ?? null;
  }, [editingSectionId, snapshot.boards]);

  /**
   * Where the rename field stands when the Board's pill cannot be measured.
   * Captured while the menu is open, because the row closes it before the field
   * mounts and the menu's point is the one the reader asked from.
   */
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (contextMenu === null) return;
    setMenuAnchor({ x: contextMenu.x, y: contextMenu.y });
  }, [contextMenu]);

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

  /**
   * The link's description being edited, and where the input sits. UI state, so
   * it lives in this component and nowhere near the document; the value it
   * commits is read back from the document at open time.
   */
  const [description, setDescription] = useState<{
    readonly edgeId: string;
    readonly x: number;
    readonly y: number;
    readonly value: string;
  } | null>(null);

  /** Commit a label: one planned write, and no write at all when it is unchanged. */
  const commitEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      const current = workspace.getEdge(edgeId)?.label ?? null;
      const plan = planEdgeLabel(
        { kind: "edge-label", edgeId, label, current },
        { capabilities: { select: true, write: canEditLayout } },
      );
      if (plan.status !== "commit") return;
      applyEdgeLabelWrite(workspace, plan.write);
      setDescription(null);
      reconcile();
    },
    [canEditLayout, reconcile, workspace],
  );

  /** The menu's description row: open the inline editor on the link's own text. */
  const startEdgeDescription = useCallback(
    (edgeId: string, point: { x: number; y: number }) => {
      setDescription({
        edgeId,
        x: point.x,
        y: point.y,
        value: workspace.getEdge(edgeId)?.label ?? "",
      });
    },
    [workspace],
  );

  /** "Remove description": the same write as an edit to nothing. */
  const clearEdgeDescription = useCallback(
    (edgeId: string) => commitEdgeLabel(edgeId, ""),
    [commitEdgeLabel],
  );

  /**
   * Routing and direction. The document is the truth and the surface re-projects
   * the drawn link's props from it (`useIceLinkGesture.projectEdges`), so these
   * are ordinary writes, not gestures. A row for *reversing* an edge is absent:
   * swapping the ends is not a prop, and the desk resolves a link's ends once.
   */
  const setEdgePath = useCallback(
    (edgeId: string, path: EdgePath) => {
      if (!canEditLayout) return;
      workspace.setEdgePath(edgeId, path);
      reconcile();
    },
    [canEditLayout, reconcile, workspace],
  );

  const setEdgeBidirectional = useCallback(
    (edgeId: string, bidirectional: boolean) => {
      if (!canEditLayout) return;
      workspace.setEdgeBidirectional(edgeId, bidirectional);
      reconcile();
    },
    [canEditLayout, reconcile, workspace],
  );

  /** "Delete link": one planned `removeEdges`, then the projection re-derives. */
  const deleteEdge = useCallback(
    (edgeId: string) => {
      const plan = planEdgeDelete(
        { kind: "edge-delete", edgeIds: [edgeId] },
        { capabilities: { select: true, write: canEditLayout } },
      );
      if (plan.status !== "commit") return;
      applyCanonicalWrite(workspaceWriter(workspace), plan.write);
      setSelectedEdgeIds([]);
      setDescription(null);
      reconcile();
    },
    [canEditLayout, reconcile, setSelectedEdgeIds, workspace],
  );

  // A double click on the ink asks for the same editor. The request is one
  // event, so the input stays in this component and the gesture never grows a
  // second one.
  useEffect(() => {
    const onRequest = (event: Event): void => {
      const request = edgeLabelRequestOf(event);
      if (request === null) return;
      startEdgeDescription(request.edgeId, { x: request.x, y: request.y });
    };
    document.addEventListener(SUITE_EDGE_LABEL_EVENT, onRequest);
    return () => document.removeEventListener(SUITE_EDGE_LABEL_EVENT, onRequest);
  }, [startEdgeDescription]);

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

  /**
   * Plants an empty Board on the plane at the click: a Board is a frame, not a
   * card, so there is no portal card and no second write (ADR-0039).
   */
  const createBoardAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!canCreateContent || !canCreateBoards) return;
      const cards = snapshot.placements.filter((entry) => entry.boardId === rootBoardId);
      const size = boardSizeForBounds(boardBounds([], cards));
      const board = workspace.createBoard({
        name: `Board ${workspace.listBoardChildren(rootBoardId).length + 1}`,
        parentBoardId: rootBoardId,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      });
      setSelectedNodeIds([]);
      useUiStore.getState().selectSection(board.id);
    },
    [canCreateBoards, canCreateContent, rootBoardId, setSelectedNodeIds, snapshot, workspace],
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
    // Each card leaves the Board it is actually on: inside an entered Board the
    // root id would name no placement and the row would quietly do nothing.
    for (const id of useUiStore.getState().selectedNodeIds) {
      workspace.unplaceCard(membership.get(id) ?? rootBoardId, id);
    }
    setSelectedNodeIds([]);
  }, [canEditLayout, membership, rootBoardId, setSelectedNodeIds, workspace]);

  const trashSelected = useCallback(() => {
    if (!canManageTrash) return;
    for (const id of useUiStore.getState().selectedNodeIds) {
      workspace.trashCard(id);
    }
    setSelectedNodeIds([]);
  }, [canManageTrash, setSelectedNodeIds, workspace]);

  /**
   * A Board's new name: one `renameBoard` write (the document trims and skips a
   * no-op), then the projection re-derives the pill. The field is only reachable
   * from the row, which is gated on layout rights.
   */
  const commitRename = useCallback(
    (boardId: string, name: string) => {
      if (canEditLayout) workspace.renameBoard(boardId, name);
      setEditingSection(null);
      reconcile();
    },
    [canEditLayout, reconcile, setEditingSection, workspace],
  );

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
    // A Board *is* the membership: the placement names the Board a card is on,
    // so "Select N cards", "Remove from board" and the count all read the truth.
    sectionMembershipMap: membership,
    // The same selection, told to the engine so ICE's own `Selected` set agrees
    // (the surface's mirror would otherwise disagree for a frame).
    syncCardSelection: selectCardsInIce,
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
    createBoardAt,
    duplicateCards,
    startEdgeDescription,
    clearEdgeDescription,
    deleteEdge,
    setEdgePath,
    setEdgeBidirectional,
    moveCardToBoard,
    unplaceSelected,
    trashSelected,
    changeLayer,
    changeLayerBulk,
    requestShare,
    // No *section* layer on ICE: a section is a Board, and a Board is drawn by
    // its mat, so the section-only entries (a new section on the plane) are
    // declined rather than offered for an action the surface cannot show.
    // Connectors *are* offered: the dots are read from the document, so an added
    // connector appears at once, and the gesture can slide and delete one.
    supportsSections: false,
    supportsConnectors: true,
    // The frame a `section` menu opens on is a Board on this surface.
    sectionNoun: "board",
  });

  return (
    <>
      {contextMenu === null ? null : (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={items} onClose={close} />
      )}
      {renaming === null ? null : (
        <BoardRenameInput
          boardId={renaming.id}
          name={renaming.name}
          fallback={menuAnchor}
          onCommit={(name) => commitRename(renaming.id, name)}
          onCancel={() => setEditingSection(null)}
        />
      )}
      {description === null ? null : (
        <EdgeDescriptionInput
          x={description.x}
          y={description.y}
          value={description.value}
          onCommit={(value) => commitEdgeLabel(description.edgeId, value)}
          onCancel={() => setDescription(null)}
        />
      )}
    </>
  );
}

const NOOP_POINT = (_point: { x: number; y: number }, _wrap?: boolean): void => {};

/** Re-exported for the surface's own listener, which needs the same mapping. */
export { menuTargetFromPick };
