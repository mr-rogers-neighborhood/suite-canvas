import type { Card, CardType, Placement } from "@suite/graph";
import type { CardMeta } from "../cards/cardMeta";

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
}
