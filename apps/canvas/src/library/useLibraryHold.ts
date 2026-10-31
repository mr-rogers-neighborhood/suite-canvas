import { useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "../store/useUiStore";

/** How far a press has to travel before it is a drag rather than a click. */
const HOLD_THRESHOLD = 4;

export interface LibraryHold {
  /** The row the press started on. A card row, or a media row before it is a card. */
  rowId: string;
  /** What the ghost shows. */
  title: string;
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
  resolveDraggedIds,
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
  /**
   * Turns a row into the cards a drag carries, on the first move past the threshold.
   *
   * A media row is not a card yet, so this is where its card is made: the drag then
   * carries a real card id and every other part of the gesture, the peer ghost and the
   * drop included, needs to know nothing about media. Returning null cancels the drag.
   */
  resolveDraggedIds?: ((rowId: string) => readonly string[] | null) | undefined;
}) {
  const setLibraryDrag = useUiStore((state) => state.setLibraryDrag);
  const [hold, setHold] = useState<{ title: string; x: number; y: number } | null>(null);
  const holdRef = useRef<LibraryHold | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = holdRef.current;
      if (!current) return;
      const far =
        Math.abs(event.clientX - current.startX) > HOLD_THRESHOLD ||
        Math.abs(event.clientY - current.startY) > HOLD_THRESHOLD;
      if (!far && !current.dragging) return;
      // The row becomes cards once, on the move that makes it a drag: a press that
      // never travels must not create anything.
      // Only a row that does not already name its cards needs resolving, which is
      // how a multi-row pick keeps carrying the whole pick.
      if (!current.dragging && resolveDraggedIds && current.cardIds.length === 0) {
        const ids = resolveDraggedIds(current.rowId);
        if (ids === null || ids.length === 0) {
          holdRef.current = null;
          setHold(null);
          return;
        }
        current.cardIds = ids;
      }
      current.dragging = true;
      // The canvas owns the camera, so this is a screen point here and a flow
      // point by the time it reaches presence.
      setLibraryDrag({
        cardId: current.cardIds[0] ?? current.rowId,
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
        if (onTap) onTap(current.rowId, event);
        else onOpen(current.rowId);
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
  }, [onDropAt, onOpen, onTap, canPlace, resolveDraggedIds, setLibraryDrag]);

  const reset = useCallback(() => setHold(null), []);

  return { hold, holdRef, setHold, reset };
}
