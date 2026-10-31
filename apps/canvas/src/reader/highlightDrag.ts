import { create } from "zustand";

/**
 * A highlight being carried out of the book.
 *
 * A drag that crosses surfaces needs one piece of shared state and nothing else: which highlight is in the reader's
 * hand and where the pointer is. The reader watches it to get out of the way, and the board watches it to know
 * when a release means "put it here".
 *
 * Nothing is created on the press. A press that never travels is a press on the mark — the card it already made, or
 * the one it should make — so a promotion only happens on a release over the board.
 */
interface HighlightDragState {
  /** The highlight in hand, or null. */
  readonly carried: { readonly annotationId: string } | null;
  /** Where the pointer is, in screen coordinates. */
  readonly screen: { readonly x: number; readonly y: number } | null;
  carry: (annotationId: string) => void;
  move: (screen: { x: number; y: number }) => void;
  release: () => void;
}

export const useHighlightDrag = create<HighlightDragState>()((set) => ({
  carried: null,
  screen: null,
  carry: (annotationId) => set({ carried: { annotationId }, screen: null }),
  move: (screen) => set({ screen }),
  release: () => set({ carried: null, screen: null }),
}));

/** How far a press has to travel before it is a drag rather than a press on a highlight. */
export const HIGHLIGHT_DRAG_THRESHOLD = 4;

/**
 * The pointer gesture, started from a mark.
 *
 * Listeners live on `window` for the length of the gesture: the pointer leaves the chapter, the focus surface and
 * the reader on its way to the board, and a drag that stopped tracking at the first boundary would be a drag the
 * reader has to get right in one go.
 */
export function beginHighlightDrag(
  annotationId: string,
  start: { x: number; y: number },
  onDrop: ((annotationId: string, screen: { x: number; y: number }) => void) | null,
): void {
  const store = useHighlightDrag.getState();
  let carrying = false;
  const root = document.documentElement;

  // A drag that crosses a dozen surfaces must not be a text selection on any of them. The attribute is the same
  // trick a resize handle uses: one rule on the root, removed on release however the gesture ended.
  const beginCarry = () => {
    root.dataset.carryingHighlight = "true";
    store.carry(annotationId);
  };

  const finish = (event: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    delete root.dataset.carryingHighlight;
    const dragging = useHighlightDrag.getState().carried !== null;
    useHighlightDrag.getState().release();
    // A press that never became a drag is a press on the mark, which the mark's own handler answers.
    if (!dragging || onDrop === null) return;
    onDrop(annotationId, { x: event.clientX, y: event.clientY });
  };
  const move = (event: PointerEvent) => {
    if (!carrying) {
      const far =
        Math.abs(event.clientX - start.x) > HIGHLIGHT_DRAG_THRESHOLD ||
        Math.abs(event.clientY - start.y) > HIGHLIGHT_DRAG_THRESHOLD;
      if (!far) return;
      carrying = true;
      beginCarry();
    }
    useHighlightDrag.getState().move({ x: event.clientX, y: event.clientY });
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  // A gesture can also end without a release — a system dialog, a lost window. The carry is cleared either way,
  // because a reader stuck with a ghost they cannot put down is worse than a cancelled drag.
  window.addEventListener("pointercancel", finish);
}
