import type { WorkspaceDocument } from "@suite/graph";
import { useCallback, useMemo } from "react";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { toBoardItems } from "../library/libraryBoards";
import type { LibraryItem } from "../library/libraryTypes";

export interface UseLibraryItemsOptions {
  snapshot: WorkspaceSnapshot;
  workspace: WorkspaceDocument;
  sectionIdsFor: (cardId: string) => string[];
  libraryOpen: boolean;
}

export interface UseLibraryItemsResult {
  unplaced: string[];
  allCards: string[];
  trashed: string[];
  boardItems: ReturnType<typeof toBoardItems>;
  inboxItems: LibraryItem[];
  cardItems: LibraryItem[];
  trashItems: LibraryItem[];
}

/**
 * Derives and memoizes the item lists required by the library drawer.
 *
 * When the drawer is closed (`libraryOpen === false`), evaluating `toItem(cardId)`
 * (which parses and walks ProseMirror Loro AST containers for every card in the workspace)
 * is deferred and empty arrays are returned.
 */
export function useLibraryItems({
  snapshot,
  workspace,
  sectionIdsFor,
  libraryOpen,
}: UseLibraryItemsOptions): UseLibraryItemsResult {
  const cards = snapshot.cards;
  const placements = snapshot.placements;
  const inbox = useMemo(
    () => cards.filter((card) => !card.deletedAt).map((card) => card.id),
    [cards],
  );
  const placedCardIds = useMemo(
    () => new Set(placements.map((placement) => placement.cardId)),
    [placements],
  );
  const unplaced = useMemo(
    () => inbox.filter((id) => !placedCardIds.has(id)),
    [inbox, placedCardIds],
  );
  const trashed = useMemo(() => {
    void cards;
    return workspace.listTrashedCards().map((card) => card.id);
  }, [workspace, cards]);
  const allCards = inbox;

  // Facet filtering lives in the drawer: it owns the section facet, and every
  // facet needs the counts computed against the others.
  const boardItems = useMemo(() => toBoardItems(snapshot), [snapshot]);

  const toItem = useCallback(
    (cardId: string): LibraryItem => {
      void snapshot;
      const card = workspace.getCard(cardId);
      return {
        id: cardId,
        title: workspace.displayTitle(cardId),
        boards: workspace.listCardPlacements(cardId).flatMap((placement) => {
          const board = workspace.getBoard(placement.boardId);
          return board ? [{ id: board.id, name: board.name }] : [];
        }),
        typeIds: card?.typeIds ?? [],
        tagIds: card?.tags ?? [],
        sectionIds: sectionIdsFor(cardId),
        properties: card?.properties ?? {},
      };
    },
    [workspace, sectionIdsFor, snapshot],
  );

  // A board is a row in the Cards tab and never in the inbox: it has no placement, so
  // "loose" is not a state one can be in, and a list of both read as a list of neither.
  const inboxItems = useMemo(() => {
    if (!libraryOpen) return [];
    return unplaced.map(toItem);
  }, [libraryOpen, unplaced, toItem]);

  const cardItems = useMemo(() => {
    if (!libraryOpen) return [];
    return [...allCards.map(toItem), ...boardItems];
  }, [libraryOpen, allCards, toItem, boardItems]);

  const trashItems = useMemo(() => {
    if (!libraryOpen) return [];
    return trashed.map(toItem);
  }, [libraryOpen, trashed, toItem]);

  return {
    unplaced,
    allCards,
    trashed,
    boardItems,
    inboxItems,
    cardItems,
    trashItems,
  };
}
