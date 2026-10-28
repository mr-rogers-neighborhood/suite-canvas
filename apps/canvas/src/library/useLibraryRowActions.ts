import type { ContextMenuItem } from "../dialogs/ContextMenu";
import { isBoardItem, type LibraryBoard, type LibraryItem, toBoardRow } from "./libraryTypes";

/**
 * The actions for one row, in one place: the ⋯ button and a right-click both read
 * this, so the menu can never offer a different set depending on how it was opened.
 */
export function useLibraryRowActions({
  tab,
  ordered,
  activeBoardId,
  canManageTrash,
  onLocateCard,
  onLocateBoard,
  onOpenBoard,
  onPlaceBoard,
  onUnplaceBoardCards,
  onRestore,
  onOpenCard,
  onGoToBoard,
  onPlace,
  onTrash,
  setLocateMiss,
  setPendingDelete,
  setPendingPurge,
}: {
  tab: string;
  ordered: LibraryItem[];
  visibleBoards: LibraryBoard[];
  activeBoardId: string | null;
  canManageTrash: boolean;
  onLocateCard: (cardId: string) => boolean;
  onLocateBoard: (boardId: string) => boolean;
  onOpenBoard: (boardId: string) => void;
  onPlaceBoard: (boardId: string) => void;
  /** Kept for the blueprints pass; nothing reads it while they are hidden. */
  onSetBoardTemplate?: ((boardId: string, template: boolean) => void) | undefined;
  onUnplaceBoardCards: (boardId: string) => void;
  onRestore: (cardId: string) => void;
  onOpenCard: (cardId: string) => void;
  onGoToBoard: (boardId: string) => void;
  onPlace: (cardId: string) => void;
  onTrash: (cardId: string) => void;
  setLocateMiss: (message: string | null) => void;
  setPendingDelete: (board: LibraryBoard) => void;
  /** Asks before a permanent delete; the drawer owns the dialog that asks. */
  setPendingPurge: (card: { id: string; title: string }) => void;
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
    const card = ordered.find((entry) => entry.id === id);

    // One lookup, two shapes: a board row's actions are about the board, a card
    // row's are about the card. Both rows come from the same list.
    if (card && isBoardItem(card)) {
      const board = toBoardRow(card, activeBoardId);
      return [
        { label: "Open", onSelect: () => onOpenBoard(board.id) },
        { label: "Place on board", onSelect: () => onPlaceBoard(board.id) },
        { label: "Locate", onSelect: () => locateBoard(board) },
        // Blueprints are unfinished and hidden until they land: a workspace
        // starter is the only template shape the product offers today.
        { label: "Unplace its cards", onSelect: () => onUnplaceBoardCards(board.id) },
        { label: "Delete board…", danger: true, onSelect: () => setPendingDelete(board) },
      ];
    }

    if (!card) return [];
    if (tab === "trash") {
      if (!canManageTrash) return [];
      return [
        { label: "Restore", onSelect: () => onRestore(card.id) },
        {
          label: "Delete forever",
          danger: true,
          // One click here is irreversible. The menu is data, so it asks the
          // drawer to open the app's own `Dialog` rather than the platform's
          // confirm, which cannot say what the rest of the app says.
          onSelect: () => setPendingPurge({ id: card.id, title: card.title }),
        },
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
            label: "Place on board",
            onSelect: () => onPlace(card.id),
          },
      ...(canManageTrash
        ? [{ label: "Move to trash", danger: true, onSelect: () => onTrash(card.id) }]
        : []),
    ];
  };

  return { menuFor };
}
