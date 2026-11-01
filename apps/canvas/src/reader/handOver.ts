import type { Annotation, WorkspaceDocument } from "@suite/graph";
import { stackInHand, usePlaceStackStore } from "../canvas/placeStack";
import { promoteAnnotation } from "./promote";

/**
 * Putting a highlight on the board, the way the library puts a stack of cards there: **in the reader's hand**.
 *
 * Placing is a gesture, not a write. The card is made in the inbox — which is where a card with no board honestly
 * belongs — and then handed to the pointer: one press on the board puts it down, the next press puts the one under it
 * down. The alternative, picking a point for the reader, is a card that appears somewhere they were not looking; that
 * is what made "Place" feel like it did nothing.
 *
 * A highlight that already came out of the book is not made twice. If its card is already on a board the reader is
 * taken to it; if it is waiting in the inbox it is handed over instead, so the second press finishes the first one's
 * work rather than starting a duplicate.
 */
export interface HandOverInput {
  workspace: WorkspaceDocument;
  annotation: Annotation;
  /** Layout rights: without them there is no hand to carry the card, so it stays in the inbox. */
  canEditPlacement: boolean;
}

export interface HandOverResult {
  /** The highlight's primary card. */
  readonly cardId: string;
  /** True when nothing was made, because the highlight already had a live card. */
  readonly existed: boolean;
  /** True when the card is in hand and the next press on the board puts it down. */
  readonly inHand: boolean;
  /** True when the card was already on a board, so there is nothing to carry. */
  readonly placedAlready: boolean;
  /**
   * True when the card the highlight already has is in the trash.
   *
   * Nothing is carried: a card in the trash has no placement, and handing one over would put the reader's own card
   * back on a board while its library row still said it was deleted. Restoring it is the library's job.
   */
  readonly trashed: boolean;
}

export function handOverHighlight(input: HandOverInput): HandOverResult {
  const { workspace, annotation, canEditPlacement } = input;
  const promoted = promoteAnnotation({ workspace, annotation, placement: { inbox: true } });

  if (promoted.trashed) {
    return {
      cardId: promoted.cardId,
      existed: true,
      inHand: false,
      placedAlready: false,
      trashed: true,
    };
  }

  const alreadyPlaced = workspace.listCardPlacements(promoted.cardId).length > 0;
  if (promoted.existed && alreadyPlaced) {
    return {
      cardId: promoted.cardId,
      existed: true,
      inHand: false,
      placedAlready: true,
      trashed: false,
    };
  }
  if (!canEditPlacement) {
    return {
      cardId: promoted.cardId,
      existed: promoted.existed,
      inHand: false,
      placedAlready: false,
      trashed: false,
    };
  }

  const stack = usePlaceStackStore.getState();
  if (stackInHand()) stack.add([promoted.cardId]);
  else stack.start([promoted.cardId]);
  return {
    cardId: promoted.cardId,
    existed: promoted.existed,
    inHand: true,
    placedAlready: false,
    trashed: false,
  };
}

/**
 * Putting several highlights into one hand.
 *
 * The same act as one, repeated: every selected highlight becomes its card in the inbox, and the cards go into the stack
 * together so one press puts one down. A highlight that already has a card contributes *that* card rather than a second
 * one, and one whose card is in the trash is skipped and reported, because handing it over would put a deleted card on a
 * board.
 *
 * Returns what happened per highlight so the surface can say "two of these were already cards" rather than nothing.
 */
export interface HandOverManyResult {
  /** The ids in the order they will be put down. */
  readonly cardIds: readonly string[];
  /** How many were already cards, so nothing was created for them. */
  readonly existed: number;
  /** How many were skipped because the card they name is in the trash. */
  readonly trashed: number;
  /** True when the cards are in hand and the next press on the board puts one down. */
  readonly inHand: boolean;
}

export function handOverHighlights(input: {
  workspace: WorkspaceDocument;
  annotations: readonly Annotation[];
  canEditPlacement: boolean;
}): HandOverManyResult {
  const { workspace, annotations, canEditPlacement } = input;
  const cardIds: string[] = [];
  let existed = 0;
  let trashed = 0;

  for (const annotation of annotations) {
    const promoted = promoteAnnotation({ workspace, annotation, placement: { inbox: true } });
    if (promoted.trashed) {
      trashed += 1;
      continue;
    }
    if (promoted.existed) existed += 1;
    cardIds.push(promoted.cardId);
  }

  // A card already on a board has nothing to place: the point of the gesture is the ones that are not.
  const placeable = cardIds.filter((cardId) => workspace.listCardPlacements(cardId).length === 0);
  if (placeable.length === 0 || !canEditPlacement) {
    return { cardIds: placeable, existed, trashed, inHand: false };
  }

  const stack = usePlaceStackStore.getState();
  if (stackInHand()) stack.add(placeable);
  else stack.start(placeable);
  return { cardIds: placeable, existed, trashed, inHand: true };
}
