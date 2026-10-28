import { useEffect, useRef, useState } from "react";
import type { CanvasMode } from "../canvas/links/linkGesture";
import {
  applySelection,
  EMPTY_SELECTION,
  gestureOf,
  type SelectionState,
  selectAll,
  selectedInOrder,
} from "./librarySelection";
import { isBoardItem, type LibraryItem } from "./libraryTypes";

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
  /** Shift is down and has not picked anything yet: the mode is only borrowed. */
  const armed = useRef(false);
  const selectedCount = useRef(0);
  useEffect(() => {
    // Leaving a run leaves selection mode with it: a selection made for a run
    // means nothing once the run has ended. Only a purpose change runs this, so
    // a reader who turned the mode on themselves keeps it.
    setSelecting(running);
  }, [running]);

  /** The rows a selection can hold, in the order on screen. */
  const selectableOrder = tab === "cards" || tab === "inbox" ? ordered.map((item) => item.id) : [];
  const selected = selectedInOrder(selection, selectableOrder);

  /**
   * Picks a row.
   *
   * With selection mode on, a plain click is **additive** — otherwise the mode
   * would be pointless, since a plain click would select one item and discard the
   * rest. Shift inside the mode is the range people expect, and Ctrl/Cmd is the
   * one-by-one toggle. A modifier still turns the mode on when it was off, so
   * holding Shift over the library starts a multi-select; releasing Shift without
   * a pick leaves the mode off.
   */
  const selectRow = (
    id: string,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    const modifier = gestureOf(event);
    if (modifier !== "replace") setSelecting(true);
    // A pick is a decision: releasing Shift afterwards must not turn the mode off.
    armed.current = false;
    const gesture = selecting && modifier === "replace" ? "add" : modifier;
    setSelection((current) => applySelection(current, id, gesture, selectableOrder));
  };

  /**
   * Holding Shift over the library is a request for the multi-select UI: it turns
   * the mode on for as long as the key is held, and off again when it is released
   * without a pick. A pick makes it a real mode.
   */
  const shiftHeld = (down: boolean) => {
    if (down) {
      if (selecting) return;
      armed.current = true;
      setSelecting(true);
      return;
    }
    if (!armed.current) return;
    armed.current = false;
    if (selectedCount.current === 0) setSelecting(false);
  };

  const toggleSelecting = () => {
    setSelecting((on) => !on);
    setSelection(EMPTY_SELECTION);
  };

  const clear = () => setSelection(EMPTY_SELECTION);
  selectedCount.current = selected.length;

  /**
   * A run places cards. A board in the selection is skipped rather than failing
   * the run: it is a row like any other in this list, but there is nothing to
   * place — placing a board is what the portal row action does.
   */
  const runnable = selected.filter((id) => {
    const item = ordered.find((entry) => entry.id === id);
    return item === undefined || !isBoardItem(item);
  });

  const runVerb = (mode: CanvasMode) => {
    if (runnable.length === 0) return;
    onRunCards?.(runnable, mode);
    // A run is now live; the selection has done its job.
    setSelection(EMPTY_SELECTION);
    setSelecting(false);
  };

  const runLoop = () => {
    if (runnable.length === 0) return;
    onRunLoop?.(runnable);
    setSelection(EMPTY_SELECTION);
    setSelecting(false);
  };

  return {
    selection,
    selecting,
    selected,
    selectableOrder,
    selectRow,
    shiftHeld,
    toggleSelecting,
    clear,
    selectAll: () => setSelection(selectAll(selectableOrder)),
    runVerb,
    runLoop,
  };
}
