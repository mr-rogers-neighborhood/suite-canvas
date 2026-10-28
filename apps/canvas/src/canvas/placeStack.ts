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
  start: (cardIds: readonly string[]) => void;
  /** The top card landed: drop it and keep the rest. */
  advance: () => void;
  /** Drop these ids: one press can retire a board and the portal that opens it. */
  remove: (ids: readonly string[]) => void;
  stop: () => void;
}

export const usePlaceStackStore = create<PlaceStackState>()((set, get) => ({
  queue: [],
  start: (cardIds) => {
    // A stack is a set: the same card twice would be one card placed twice.
    const unique = [...new Set(cardIds)];
    set({ queue: unique.length === 0 ? [] : unique });
  },
  advance: () => {
    const queue = get().queue.slice(1);
    set({ queue });
  },
  remove: (ids) => {
    const gone = new Set(ids);
    set({ queue: get().queue.filter((id) => !gone.has(id)) });
  },
  stop: () => set({ queue: [] }),
}));

/** Whether a press belongs to the stack rather than to whatever is under it. */
export function stackInHand(): boolean {
  return usePlaceStackStore.getState().queue.length > 0;
}
