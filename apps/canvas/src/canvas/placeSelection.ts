import { PORTAL_BOARD_FIELD_ID, type WorkspaceDocument } from "@suite/graph";

/**
 * What a library selection means on the canvas.
 *
 * A library row is either a card or a board, and the two are placed differently: a card
 * is put on a board, and a board is opened from one — so placing a board means a portal
 * card. Both live in the same list and the same selection, so one function decides, and
 * the drag and the stack ask the same question.
 */
export type PlaceItem = { kind: "card"; cardId: string } | { kind: "board"; boardId: string };

/**
 * Turns picked row ids into the things that get placed, in the order they were picked.
 *
 * A board is placed once. A board that already has a portal card on this board is
 * *that* portal, not a second one: the library shows the board's row and the portal
 * card's row, so a selection can name both, and creating another portal for the pair is
 * how one board ended up with two portals over it.
 */
export function resolveSelection(
  ids: readonly string[],
  lookup: {
    /** Whether a row id names a board rather than a card. */
    isBoard: (id: string) => boolean;
    /** The board a portal card opens, if it opens one. */
    opens: (cardId: string) => string | undefined;
  },
): PlaceItem[] {
  const seenBoards = new Set<string>();
  const seen = new Set<string>();
  const items: PlaceItem[] = [];
  for (const id of ids) {
    if (!lookup.isBoard(id)) {
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({ kind: "card", cardId: id });
      continue;
    }
    if (seenBoards.has(id)) continue;
    seenBoards.add(id);
    // The portal that already opens this board is the row that gets placed, so a
    // selection naming both the board and its portal places one thing, not two.
    const existing = ids.find((other) => other !== id && lookup.opens(other) === id);
    if (existing === undefined) {
      items.push({ kind: "board", boardId: id });
      continue;
    }
    if (seen.has(existing)) continue;
    seen.add(existing);
    items.push({ kind: "card", cardId: existing });
  }
  return items;
}

/** The readers a selection needs, from the document itself. */
export function placementLookup(workspace: WorkspaceDocument) {
  return {
    isBoard: (id: string) => workspace.getBoard(id) !== undefined,
    opens: (cardId: string): string | undefined => {
      const target = workspace.getCard(cardId)?.properties[PORTAL_BOARD_FIELD_ID];
      return typeof target === "string" && target.length > 0 ? target : undefined;
    },
    /**
     * The portal card that opens this board, wherever it is: one board has one portal
     * row in the library, and placing the board places *it*. Creating a second portal
     * because the first was in the inbox is how one board ended up with two.
     */
    portalFor: (boardId: string): string | undefined =>
      workspace
        .listCards()
        .map((card) => card.id)
        .find((id) => workspace.getCard(id)?.properties[PORTAL_BOARD_FIELD_ID] === boardId),
  };
}
