import { useEffect, useState } from "react";
import type { CanvasMode } from "../canvas/links/linkGesture";
import {
  applySelection,
  EMPTY_SELECTION,
  gestureOf,
  type SelectionState,
  selectAll,
  selectedInOrder,
} from "./librarySelection";
import type { LibraryItem } from "./libraryTypes";

/**
 * Row selection: the input every bulk action and every run shares (ADR-0011
 * amendment, ADR-0063). It is drawer state, not document state — nothing about a
 * selection is stored.
 */
export function useLibrarySelection({
  tab,
  ordered,
  running,
  onRunCards,
  onRunLoop,
}: {
  tab: string;
  /** The rows in the order on screen; a run places in this order. */
  ordered: LibraryItem[];
  /** A live run keeps selection mode on, and its end leaves it (ADR-0064 §10). */
  running: boolean;
  onRunCards: ((cardIds: readonly string[], mode: CanvasMode) => void) | undefined;
  onRunLoop: ((cardIds: readonly string[]) => void) | undefined;
}) {
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  /**
   * Selection mode. A plain click opens a card — that is the drawer's dominant
   * gesture — so bulk selection is opted into with one button rather than inferred
   * from a modifier, and the mode says so in the header while it is on.
   */
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    // Leaving a run leaves selection mode with it: a selection made for a run
    // means nothing once the run has ended. Only a purpose change runs this, so
    // a reader who turned the mode on themselves keeps it.
    setSelecting(running);
  }, [running]);

  /** The rows a selection can hold, in the order on screen. */
  const selectableOrder = tab === "cards" || tab === "inbox" ? ordered.map((item) => item.id) : [];
  const selected = selectedInOrder(selection, selectableOrder);

  const selectRow = (
    id: string,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    const gesture = gestureOf(event);
    setSelection((current) => applySelection(current, id, gesture, selectableOrder));
  };

  const toggleSelecting = () => {
    setSelecting((on) => !on);
    setSelection(EMPTY_SELECTION);
  };

  const clear = () => setSelection(EMPTY_SELECTION);

  const runVerb = (mode: CanvasMode) => {
    if (selected.length === 0) return;
    onRunCards?.(selected, mode);
    // A run is now live; the selection has done its job.
    setSelection(EMPTY_SELECTION);
    setSelecting(false);
  };

  const runLoop = () => {
    if (selected.length === 0) return;
    onRunLoop?.(selected);
    setSelection(EMPTY_SELECTION);
    setSelecting(false);
  };

  return {
    selection,
    selecting,
    selected,
    selectableOrder,
    selectRow,
    toggleSelecting,
    clear,
    selectAll: () => setSelection(selectAll(selectableOrder)),
    runVerb,
    runLoop,
  };
}
