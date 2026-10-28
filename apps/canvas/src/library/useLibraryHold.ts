import { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "../store/useUiStore";
import type { LibraryItem } from "./libraryTypes";

/** How far a press has to travel before it is a drag rather than a click. */
const HOLD_THRESHOLD = 4;

export interface LibraryHold {
  /** The row the press started on, which is what the ghost names. */
  cardId: string;
  /** Everything the drop places: the picked rows, or just this one. */
  cardIds: readonly string[];
  startX: number;
  startY: number;
  dragging: boolean;
}

/**
 * The hold-to-place gesture: a press lifts the row into a ghost that follows the
 * cursor, a drop over the canvas places the card, and a press that never moved is
 * a plain click on the row.
 */
export function useLibraryHold({
  onDropAt,
  onOpen,
  onTap,
  canPlace,
}: {
  onDropAt: (cardIds: readonly string[], point: { x: number; y: number }) => void;
  /** A press that never moved: open whatever the row names. */
  onOpen: (id: string) => void;
  /**
   * What a press that never moved means instead, when the drawer is in a mode where a
   * click on a row does something else — a pick, not an open.
   */
  onTap?: ((id: string, event: PointerEvent) => void) | undefined;
  /** A viewer's ghost still travels; the drop does nothing. */
  canPlace: boolean;
}) {
  const setLibraryDrag = useUiStore((state) => state.setLibraryDrag);
  const [hold, setHold] = useState<{ item: LibraryItem; x: number; y: number } | null>(null);
  const holdRef = useRef<LibraryHold | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = holdRef.current;
      if (!current) return;
      const far =
        Math.abs(event.clientX - current.startX) > HOLD_THRESHOLD ||
        Math.abs(event.clientY - current.startY) > HOLD_THRESHOLD;
      if (!far && !current.dragging) return;
      current.dragging = true;
      // The canvas owns the camera, so this is a screen point here and a flow
      // point by the time it reaches presence.
      setLibraryDrag({
        cardId: current.cardId,
        screen: { x: event.clientX, y: event.clientY },
        count: current.cardIds.length,
      });
      setHold((previous) =>
        previous ? { ...previous, x: event.clientX, y: event.clientY } : null,
      );
    };

    const up = (event: PointerEvent) => {
      const current = holdRef.current;
      holdRef.current = null;
      setHold(null);
      setLibraryDrag(null);
      if (!current) return;
      // A press that never became a drag is a plain click on the row.
      if (!current.dragging) {
        if (onTap) onTap(current.cardId, event);
        else onOpen(current.cardId);
        return;
      }
      // A viewer's ghost still travelled; the drop does nothing, which is the
      // same answer the capability matrix gives every other layout write.
      if (!canPlace) return;
      // The board element, or React Flow's own container: a section is drawn from a
      // portal outside the board element, so a drop aimed at one would otherwise read
      // as a drop on nothing.
      const canvas = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-testid="canvas-board"], .react-flow');
      if (canvas) onDropAt(current.cardIds, { x: event.clientX, y: event.clientY });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [onDropAt, onOpen, onTap, canPlace, setLibraryDrag]);

  const reset = useCallback(() => setHold(null), []);

  return { hold, holdRef, setHold, reset };
}
