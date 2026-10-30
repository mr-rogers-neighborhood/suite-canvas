import { PORTAL_BOARD_FIELD_ID, type WorkspaceDocument } from "@suite/graph";
import { useCallback } from "react";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { createStarterBoard, templateCopyName } from "../library/TemplateGallery";
import { useUiStore } from "../store/useUiStore";

export interface UseBoardLibraryActionsOptions {
  workspace: WorkspaceDocument;
  snapshot: WorkspaceSnapshot;
  activeBoardId: string | null;
  canEditLayout: boolean;
  canManageBoards: boolean;
  canCreateBoards: boolean;
  focusCard: (cardId: string, boardId: string) => void;
  activateBoard: (boardId: string) => void;
  setActiveBoardId: (boardId: string | null) => void;
  setLibraryOpen: (open: boolean) => void;
}

export interface UseBoardLibraryActionsResult {
  locateCard: (cardId: string) => boolean;
  locateBoard: (boardId: string) => boolean;
  unplaceBoardCards: (boardId: string) => void;
  deleteBoard: (boardId: string, cards: "keep" | "trash") => void;
  useBoardTemplate: (templateId: string) => void;
  useStarter: (starterId: string) => void;
  setBoardTemplate: (boardId: string, template: boolean) => void;
}

/**
 * Callbacks for board manipulation and locating items from the shell/library drawer.
 */
export function useBoardLibraryActions({
  workspace,
  snapshot,
  activeBoardId,
  canEditLayout,
  canManageBoards,
  canCreateBoards,
  focusCard,
  activateBoard,
  setActiveBoardId,
  setLibraryOpen,
}: UseBoardLibraryActionsOptions): UseBoardLibraryActionsResult {
  /**
   * Locate pans to the object on the board in front of the reader. A card that
   * is not placed here has nowhere to pan to, so the drawer is told so instead
   * of the camera moving somewhere unrelated.
   */
  const locateCard = useCallback(
    (cardId: string): boolean => {
      if (!activeBoardId) return false;
      const card = workspace.getCard(cardId);
      if (!card || card.deletedAt) return false;
      const onBoard = snapshot.placements.some(
        (placement) => placement.boardId === activeBoardId && placement.cardId === cardId,
      );
      if (!onBoard) return false;
      focusCard(cardId, activeBoardId);
      return true;
    },
    [activeBoardId, snapshot.placements, workspace, focusCard],
  );

  /** A portal on this board is the nearest thing a board has to a position. */
  const locateBoard = useCallback(
    (boardId: string): boolean => {
      if (activeBoardId && activeBoardId !== boardId) {
        const portal = snapshot.placements
          .filter((placement) => placement.boardId === activeBoardId)
          .map((placement) => workspace.getCard(placement.cardId))
          .find(
            (card) =>
              card !== undefined &&
              !card.deletedAt &&
              card.properties[PORTAL_BOARD_FIELD_ID] === boardId,
          );
        if (portal) {
          focusCard(portal.id, activeBoardId);
          return true;
        }
      }
      // Without a portal here, opening the board is the only way to show it.
      activateBoard(boardId);
      return true;
    },
    [activeBoardId, snapshot.placements, workspace, focusCard, activateBoard],
  );

  /** Unplacing is per board: a card that also lives elsewhere stays there. */
  const unplaceBoardCards = useCallback(
    (boardId: string) => {
      if (!canEditLayout) return;
      for (const card of workspace.listBoardCards(boardId)) {
        workspace.unplaceCard(boardId, card.id);
      }
    },
    [canEditLayout, workspace],
  );

  /**
   * Delete asks once, in the library. If the board on screen goes, the shell
   * resolves the next one the same way it resolves a boot.
   */
  const deleteBoard = useCallback(
    (boardId: string, cards: "keep" | "trash") => {
      if (!canManageBoards) return;
      workspace.deleteBoard(boardId, { cards });
      if (useUiStore.getState().activeBoardId === boardId) setActiveBoardId(null);
    },
    [canManageBoards, workspace, setActiveBoardId],
  );

  /**
   * Using a template *duplicates* it: sections, cards, placements and internal
   * links land as a new board in one undoable batch, and the template itself is
   * never written. The drawer closes because the new board is now in front.
   */
  const useBoardTemplate = useCallback(
    (templateId: string) => {
      if (!canCreateBoards) return;
      const source = workspace.getBoard(templateId);
      if (!source) return;
      const existing = workspace.listBoards().map((board) => board.name);
      const board = workspace.duplicateBoard(templateId, {
        name: templateCopyName(source.name, existing),
      });
      if (!board) return;
      activateBoard(board.id);
      setLibraryOpen(false);
    },
    [canCreateBoards, workspace, activateBoard, setLibraryOpen],
  );

  /** A built-in starter is generated on pick, never on boot. */
  const useStarter = useCallback(
    (starterId: string) => {
      if (!canCreateBoards) return;
      const existing = workspace.listBoards().map((board) => board.name);
      const boardId = createStarterBoard(workspace, starterId, existing);
      if (!boardId) return;
      activateBoard(boardId);
      setLibraryOpen(false);
    },
    [canCreateBoards, workspace, activateBoard, setLibraryOpen],
  );

  /** The flag is the whole feature: it never changes what the board holds. */
  const setBoardTemplate = useCallback(
    (boardId: string, template: boolean) => {
      if (!canManageBoards) return;
      workspace.setBoardTemplate(boardId, template);
    },
    [canManageBoards, workspace],
  );

  return {
    locateCard,
    locateBoard,
    unplaceBoardCards,
    deleteBoard,
    useBoardTemplate,
    useStarter,
    setBoardTemplate,
  };
}
