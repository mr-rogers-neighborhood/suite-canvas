import { create } from "zustand";

/** One connector that took part in a link just written, for the highlight. */
export interface ConnectorFlash {
  nodeId: string;
  connectorId: string;
}

/** How long a connector stays lit after a placement links through it. */
const FLASH_MS = 900;

let flashTimer: number | null = null;

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
  /**
   * The card put down most recently, in any mode.
   *
   * The anchor is what a *mode* means, so it moves differently in a thread and a fan;
   * this is the plain fact both agree on, and it is what a change of mode continues
   * from: fan two cards and switch to threading, and the chain carries on from the card
   * just placed rather than from the hub the fan started at.
   */
  lastPlacedId: string | null;
  /** The connectors a fresh link just used, lit briefly so the reader sees the join. */
  flash: readonly ConnectorFlash[];
  /**
   * The cards this stack has put down, in the order it put them down.
   *
   * A stack outlives one press, so undo has something to hand back: undoing a placement
   * this stack made returns the card to the hand instead of leaving it in the inbox with
   * nothing on screen to explain where it went.
   */
  placed: readonly string[];
  start: (cardIds: readonly string[], anchorId?: string | null) => void;
  setAnchor: (cardId: string | null) => void;
  setLastPlaced: (cardId: string | null) => void;
  notePlaced: (cardId: string) => void;
  /** Take back the cards whose placement is gone, top first. */
  reclaim: (missing: readonly string[]) => void;
  flashConnectors: (pairs: readonly ConnectorFlash[]) => void;
  /** The top card landed: drop it and keep the rest. */
  advance: () => void;
  /** Drop these ids: one press can retire a board and the portal that opens it. */
  remove: (ids: readonly string[]) => void;
  stop: () => void;
}

export const usePlaceStackStore = create<PlaceStackState>()((set, get) => ({
  queue: [],
  anchorId: null,
  lastPlacedId: null,
  flash: [],
  placed: [],
  start: (cardIds, anchorId = null) => {
    // A stack is a set: the same card twice would be one card placed twice.
    const unique = [...new Set(cardIds)];
    // A seeded anchor is the card the reader meant, so it is also the "last placed"
    // a mode switch would continue from.
    set({ queue: unique, anchorId, lastPlacedId: anchorId, flash: [], placed: [] });
  },
  setAnchor: (anchorId) => set({ anchorId }),
  setLastPlaced: (lastPlacedId) => set({ lastPlacedId }),
  notePlaced: (cardId) => {
    const { placed } = get();
    if (placed.includes(cardId)) return;
    set({ placed: [...placed, cardId] });
  },
  reclaim: (missing) => {
    const gone = new Set(missing);
    const placed = get().placed.filter((id) => !gone.has(id));
    if (placed.length === get().placed.length) return;
    // The cards come back on top of the hand, in the order they left it: undoing twice
    // gives back two cards in the reverse of the order they were put down.
    const returning = [...get().placed].filter((id) => gone.has(id)).reverse();
    const lastPlacedId = placed[placed.length - 1] ?? null;
    set({
      queue: [...returning, ...get().queue],
      placed,
      lastPlacedId,
      // The anchor follows what is still on the board: an anchor on a card the undo
      // removed would make the next press link to nothing, which is the bug that made a
      // re-thread after an undo quietly draw no line at all.
      anchorId: lastPlacedId,
    });
  },
  flashConnectors: (pairs) => {
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    set({ flash: pairs });
    flashTimer = window.setTimeout(() => {
      flashTimer = null;
      set({ flash: [] });
    }, FLASH_MS);
  },
  advance: () => {
    const queue = get().queue.slice(1);
    set({ queue });
  },
  remove: (ids) => {
    const gone = new Set(ids);
    set({ queue: get().queue.filter((id) => !gone.has(id)) });
  },
  stop: () => {
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = null;
    set({ queue: [], anchorId: null, lastPlacedId: null, flash: [], placed: [] });
  },
}));

/** Whether a press belongs to the stack rather than to whatever is under it. */
export function stackInHand(): boolean {
  return usePlaceStackStore.getState().queue.length > 0;
}
