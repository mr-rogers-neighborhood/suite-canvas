import { create } from "zustand";

/**
 * A stack of cards in the reader's hand.
 *
 * Multi-select rows in the library, press "Place cards", and the selection becomes a
 * stack the pointer carries: one press puts the top card down, and the next press puts
 * the one under it down. There is no shape, no anchor and no line: placing a stack is
 * placing cards, and the links between them are the reader's to draw afterwards.
 */
interface PlaceStackState {
  /** Cards waiting to be put down, top first. Empty means nothing is in hand. */
  queue: readonly string[];
  /**
   * The card the next placement attaches to, when the mode is `thread` or `fan`.
   *
   * A thread moves it to the card it just linked; a fan keeps one hub for the whole
   * stack. It is UI state, not document state: which card is "the anchor" is a fact about
   * this gesture, and it dies with the stack.
   */
  anchorId: string | null;
  start: (cardIds: readonly string[], anchorId?: string | null) => void;
  setAnchor: (cardId: string | null) => void;
  /** The top card landed: drop it and keep the rest. */
  advance: () => void;
  /** Drop these ids: one press can retire a board and the portal that opens it. */
  remove: (ids: readonly string[]) => void;
  stop: () => void;
}

export const usePlaceStackStore = create<PlaceStackState>()((set, get) => ({
  queue: [],
  anchorId: null,
  start: (cardIds, anchorId = null) => {
    // A stack is a set: the same card twice would be one card placed twice.
    const unique = [...new Set(cardIds)];
    set({ queue: unique, anchorId });
  },
  setAnchor: (anchorId) => set({ anchorId }),
  advance: () => {
    const queue = get().queue.slice(1);
    set({ queue });
  },
  remove: (ids) => {
    const gone = new Set(ids);
    set({ queue: get().queue.filter((id) => !gone.has(id)) });
  },
  stop: () => set({ queue: [], anchorId: null }),
}));

/** Whether a press belongs to the stack rather than to whatever is under it. */
export function stackInHand(): boolean {
  return usePlaceStackStore.getState().queue.length > 0;
}
