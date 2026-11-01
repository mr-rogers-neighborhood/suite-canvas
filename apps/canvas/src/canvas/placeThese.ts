import type { WorkspaceDocument } from "@suite/graph";
import { stackInHand, usePlaceStackStore } from "../canvas/placeStack";

/**
 * Putting a set of cards into the reader's hand.
 *
 * The library's **Place cards** and a book's **Place N** are the same gesture: some cards, one press each, in the order
 * the reader arranged. They grew separately — the library called `startPlaceStack` on the store and closed its drawer,
 * the book promoted its highlights and then started a stack — so "what happens when I place" had two answers that could
 * drift. This is the one answer.
 *
 * Pure with respect to the canvas: it touches the document only to ask where a card already sits, and the stack only
 * through the store.
 */
export interface PlaceTheseResult {
  /** The ids in the order they will be put down. */
  readonly cardIds: readonly string[];
  /** True when they are in the reader's hand and the next press puts one down. */
  readonly inHand: boolean;
}

export function placeThese(input: {
  workspace: WorkspaceDocument;
  cardIds: readonly string[];
  /**
   * The board being placed onto, when there is one.
   *
   * A card already on *this* board has nothing to place, and one press must never move what the reader arranged. A card on
   * a different board is still placeable here: the same note can be pinned to two boards, and refusing that would be a
   * rule nobody asked for.
   */
  boardId?: string | null;
  /**
   * The book a stack came from, when it came from a reader.
   *
   * It is what makes running out of cards offer "return to the book" rather than throwing the reader back, and it dies
   * with the stack like everything else about a gesture.
   */
  fromBook?: string | null;
  /**
   * The card a linking mode continues from, which is the card the reader had selected.
   *
   * A fan keeps it as its hub and a thread moves it on with each placement, so the seed is where the gesture starts
   * rather than something the stack decides.
   */
  anchorId?: string | null;
  canEditPlacement: boolean;
}): PlaceTheseResult {
  const {
    workspace,
    cardIds,
    boardId = null,
    fromBook = null,
    anchorId = null,
    canEditPlacement,
  } = input;

  // A card already on this board is not a card to place: the gesture is about the ones that are not there yet, and one
  // press must never move something the reader already arranged.
  const placeable = [...new Set(cardIds)].filter((cardId) =>
    boardId === null
      ? workspace.listCardPlacements(cardId).length === 0
      : workspace.getPlacement(boardId, cardId) === undefined,
  );
  if (placeable.length === 0 || !canEditPlacement) return { cardIds: placeable, inHand: false };

  const stack = usePlaceStackStore.getState();
  // Added rather than replacing: a second Place while a stack is in hand adds to it, which is what the reader means by
  // pressing it again before putting anything down.
  if (stackInHand()) stack.add(placeable);
  else stack.start(placeable, anchorId, { fromBook });
  return { cardIds: placeable, inHand: true };
}
