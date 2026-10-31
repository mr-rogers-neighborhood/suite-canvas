import type { Card, CardType, Placement } from "@suite/graph";
import type { CardMeta } from "../cards/cardMeta";

/**
 * The height a folded card renders at: the header line and nothing else.
 *
 * The stored placement keeps its own height, so unfolding restores the card
 * exactly where the reader left it. A fold is a reading state, not a resize.
 */
export const COLLAPSED_CARD_HEIGHT = 38;

/** Everything a card node needs to paint, derived per board render. */
export interface CardNodeData extends Record<string, unknown> {
  card: Card;
  placement: Placement;
  type: CardType;
  meta: CardMeta;
  /**
   * Off the active lens: the card is outside the applied view's result. It stays
   * clickable and draggable; dimming is a reading aid, never a lock.
   */
  dim?: boolean;
  /**
   * On the active lens: the card *is* the result. Outlined so the context reads as a set,
   * and separate from `dim` because either toggle can be off.
   */
  onLens?: boolean;
  /** Reduced to the header line: reader state, never written to the document. */
  collapsed?: boolean;
}
