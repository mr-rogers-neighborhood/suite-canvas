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
}

export function handOverHighlight(input: HandOverInput): HandOverResult | null {
  const { workspace, annotation, canEditPlacement } = input;
  const promoted = promoteAnnotation({ workspace, annotation, placement: { inbox: true } });
  if (promoted === null) return null;

  const alreadyPlaced = workspace.listCardPlacements(promoted.cardId).length > 0;
  if (promoted.existed && alreadyPlaced) {
    return { cardId: promoted.cardId, existed: true, inHand: false, placedAlready: true };
  }
  if (!canEditPlacement) {
    return {
      cardId: promoted.cardId,
      existed: promoted.existed,
      inHand: false,
      placedAlready: false,
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
  };
}
