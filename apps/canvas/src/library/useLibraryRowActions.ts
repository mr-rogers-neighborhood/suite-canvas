import type { ContextMenuItem } from "../dialogs/ContextMenu";
import type { LibraryBoard, LibraryItem } from "./libraryTypes";

/**
 * The actions for one row, in one place: the ⋯ button and a right-click both read
 * this, so the menu can never offer a different set depending on how it was opened.
 */
export function useLibraryRowActions({
  tab,
  ordered,
  visibleBoards,
  activeBoardId,
  runActive,
  canManageTrash,
  onLocateCard,
  onLocateBoard,
  onOpenBoard,
  onPlaceBoard,
  onSetBoardTemplate,
  onUnplaceBoardCards,
  onRestore,
  onDeleteForever,
  onOpenCard,
  onGoToBoard,
  onPlace,
  onQueueCards,
  onTrash,
  setLocateMiss,
  setPendingDelete,
}: {
  tab: string;
  ordered: LibraryItem[];
  visibleBoards: LibraryBoard[];
  activeBoardId: string | null;
  runActive: boolean;
  canManageTrash: boolean;
  onLocateCard: (cardId: string) => boolean;
  onLocateBoard: (boardId: string) => boolean;
  onOpenBoard: (boardId: string) => void;
  onPlaceBoard: (boardId: string) => void;
  onSetBoardTemplate: ((boardId: string, template: boolean) => void) | undefined;
  onUnplaceBoardCards: (boardId: string) => void;
  onRestore: (cardId: string) => void;
  onDeleteForever: (cardId: string) => void;
  onOpenCard: (cardId: string) => void;
  onGoToBoard: (boardId: string) => void;
  onPlace: (cardId: string) => void;
  onQueueCards: ((cardIds: readonly string[]) => void) | undefined;
  onTrash: (cardId: string) => void;
  setLocateMiss: (message: string | null) => void;
  setPendingDelete: (board: LibraryBoard) => void;
}) {
  // A card row only offers Locate when the card is on the board in front of the
  // reader, so a failed Locate is not a state a card row can reach: an unplaced
  // card has nowhere to pan to, and `Place` is the action it does have.
  const locateCard = (item: LibraryItem) => {
    setLocateMiss(null);
    onLocateCard(item.id);
  };

  /**
   * Whether this row's card is placed on the active board. Place and Locate are
   * one pair of meanings across the library and the inspector: a card already
   * here is located, a card that is not is placed.
   */
  const placedHere = (item: LibraryItem): boolean =>
    activeBoardId !== null && item.boards.some((board) => board.id === activeBoardId);

  const locateBoard = (board: LibraryBoard) => {
    if (onLocateBoard(board.id)) {
      setLocateMiss(null);
      return;
    }
    setLocateMiss(`\u201c${board.title}\u201d has no portal on this board.`);
  };

  /**
   * The actions for one row, in one place. The ⋯ button and a right-click both
   * read this, so the menu can never offer a different set depending on how it
   * was opened, and the list stays the whole truth about what a row can do.
   */
  const menuFor = (id: string): ContextMenuItem[] => {
    const card = tab === "boards" ? undefined : ordered.find((entry) => entry.id === id);
    const board = tab === "boards" ? visibleBoards.find((entry) => entry.id === id) : undefined;

    if (board) {
      return [
        { label: "Open", onSelect: () => onOpenBoard(board.id) },
        { label: "Place on board", onSelect: () => onPlaceBoard(board.id) },
        { label: "Locate", onSelect: () => locateBoard(board) },
        ...(onSetBoardTemplate
          ? [
              {
                label: board.template === true ? "Stop being a blueprint" : "Save as blueprint",
                onSelect: () => onSetBoardTemplate(board.id, board.template !== true),
              },
            ]
          : []),
        { label: "Unplace its cards", onSelect: () => onUnplaceBoardCards(board.id) },
        { label: "Delete board…", danger: true, onSelect: () => setPendingDelete(board) },
      ];
    }

    if (!card) return [];
    if (tab === "trash") {
      if (!canManageTrash) return [];
      return [
        { label: "Restore", onSelect: () => onRestore(card.id) },
        { label: "Delete forever", danger: true, onSelect: () => onDeleteForever(card.id) },
      ];
    }
    return [
      { label: "Open details", onSelect: () => onOpenCard(card.id) },
      ...(card.boards.length > 0
        ? [{ label: "Go to board", onSelect: () => onGoToBoard(card.boards[0]?.id ?? "") }]
        : []),
      placedHere(card)
        ? { label: "Locate", onSelect: () => locateCard(card) }
        : {
            // While a run is live, picking another card is the loop: it joins the
            // sequence instead of starting a second run beside it (ADR-0063 §6).
            label: runActive ? "Place next" : "Place on board",
            onSelect: () => (runActive ? onQueueCards?.([card.id]) : onPlace(card.id)),
          },
      ...(canManageTrash
        ? [{ label: "Move to trash", danger: true, onSelect: () => onTrash(card.id) }]
        : []),
    ];
  };

  return { menuFor };
}
