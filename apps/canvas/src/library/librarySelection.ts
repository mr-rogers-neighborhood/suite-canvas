/**
 * Row selection in the library: the input every bulk action and every placement
 * run shares (ADR-0011
 * amendment, ADR-0063).
 *
 * Pure, so the three gestures (click, `⌘`/`Ctrl`-click, `Shift`-click) are one
 * function each — and so "the order the user can see" is a tested property rather
 * than whatever the DOM happened to iterate.
 */

/** What a click means to the selection, decided by the modifiers. */
export type SelectionGesture = "replace" | "add" | "range";

/** The gesture a pointer event asks for. */
export function gestureOf(input: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): SelectionGesture {
  if (input.shiftKey) return "range";
  if (input.metaKey || input.ctrlKey) return "add";
  return "replace";
}

export interface SelectionState {
  /** Selected ids, in the order they were selected. */
  ids: readonly string[];
  /** The row a `Shift`-click ranges from: the last row clicked without Shift. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { ids: [], anchor: null };

/**
 * Apply one click to a selection.
 *
 * `order` is the visible list — the rows on screen, already in the user's order.
 * A range is the slice between the anchor and the clicked row *in that order*, so
 * a filtered or re-sorted list ranges over what is actually visible.
 */
export function applySelection(
  state: SelectionState,
  clicked: string,
  gesture: SelectionGesture,
  order: readonly string[],
): SelectionState {
  switch (gesture) {
    case "replace":
      return { ids: [clicked], anchor: clicked };
    case "add": {
      // The anchor follows the row just added, so a later Shift-click ranges from
      // where the reader's attention last was rather than from the first click.
      if (state.ids.includes(clicked)) {
        return { ids: state.ids.filter((id) => id !== clicked), anchor: clicked };
      }
      return { ids: [...state.ids, clicked], anchor: clicked };
    }
    case "range": {
      const from = state.anchor === null ? clicked : state.anchor;
      const anchorIndex = order.indexOf(from);
      const clickedIndex = order.indexOf(clicked);
      // A row that is not in the visible list cannot anchor a range; treat it as a
      // plain click rather than selecting an arbitrary slice.
      if (anchorIndex === -1 || clickedIndex === -1) {
        return { ids: [clicked], anchor: clicked };
      }
      const [start, end] =
        anchorIndex <= clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
      return { ids: order.slice(start, end + 1), anchor: from };
    }
  }
}

/** Every row of the visible list, anchored at the top, for "select all". */
export function selectAll(order: readonly string[]): SelectionState {
  return { ids: [...order], anchor: order[0] ?? null };
}

/** The selected ids in visible order, which is the order a run places them in. */
export function selectedInOrder(state: SelectionState, order: readonly string[]): string[] {
  const selected = new Set(state.ids);
  return order.filter((id) => selected.has(id));
}
