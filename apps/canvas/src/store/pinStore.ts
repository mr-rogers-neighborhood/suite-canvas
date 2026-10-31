import { create } from "zustand";

/** Where a pin sits in shell coordinates, as the shell measures it now. */
export interface PinRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The cards the reader pinned to the shell.
 *
 * This is UI state and never document data. A pin says where this reader is looking: it is
 * measured against the title bar, the dock and the inspector of the window in front of them,
 * so syncing it would turn arranging your own screen into a collaborative edit that moves someone else's
 * pins around while they read. The board remembers the card; the shell remembers
 * only where this reader put it, and the pin dies with the window.
 */
interface PinState {
  /** Pinned card ids, in the order they were pinned, so the shell can lay them out in turn. */
  pinned: readonly string[];
  /** The rect of each pin, keyed by card id. */
  rects: Readonly<Record<string, PinRect>>;
  pin: (cardId: string, rect: PinRect) => void;
  unpin: (cardId: string) => void;
  /** Records a new rect for an already pinned card, as a drag or a resize hands one over. */
  setRect: (cardId: string, rect: PinRect) => void;
  clear: () => void;
}

export const usePinStore = create<PinState>()((set, get) => ({
  pinned: [],
  rects: {},
  pin: (cardId, rect) => {
    const { pinned, rects } = get();
    // Pinning twice is one pin: the second call is a re-measure, not a second copy of the card.
    set({
      pinned: pinned.includes(cardId) ? pinned : [...pinned, cardId],
      rects: { ...rects, [cardId]: rect },
    });
  },
  unpin: (cardId) => {
    const { pinned, rects } = get();
    if (!pinned.includes(cardId) && rects[cardId] === undefined) return;
    set({ pinned: pinned.filter((id) => id !== cardId), rects: without(rects, cardId) });
  },
  setRect: (cardId, rect) => {
    // A rect for a card that is not pinned belongs to a drag that has already ended, so taking
    // it would resurrect a pin the reader removed while the pointer was still down.
    if (!get().pinned.includes(cardId)) return;
    set({ rects: { ...get().rects, [cardId]: rect } });
  },
  clear: () => set({ pinned: [], rects: {} }),
}));

/** Whether a card is pinned, read outside React so a pointer handler can ask without subscribing. */
export function isPinned(cardId: string): boolean {
  return usePinStore.getState().pinned.includes(cardId);
}

function without(
  rects: Readonly<Record<string, PinRect>>,
  cardId: string,
): Readonly<Record<string, PinRect>> {
  return Object.fromEntries(Object.entries(rects).filter(([id]) => id !== cardId));
}
