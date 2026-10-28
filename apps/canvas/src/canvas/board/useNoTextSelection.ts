import { useEffect } from "react";

/**
 * Where a press may still begin a text selection: an editor, a field, a dialog.
 *
 * A dialog is exempt because reading and copying what it says is the point of it, and
 * a card's editor because picking a word out of a card being written is a normal thing
 * to want. A card's *read-only* chrome is not: it is a picture of text.
 */
const SELECTABLE = "[contenteditable='true'], .ProseMirror, input, textarea, [role='dialog']";

/**
 * The canvas is not a text surface, so a drag across it selects nothing.
 *
 * Shift is the marquee key here, and a browser reads the same shift as "extend the
 * selection from the last anchor", which is why a shift+drag could sweep every word on
 * the page. Cancelling `selectstart` alone does not fix it: that event fires when a
 * selection *begins*, and an extension of one already there never fires it at all — so
 * the sweep came back the moment anything had been selected before the gesture.
 *
 * The press is where it can be stopped, and it takes two things. **Dropping the ranges**
 * removes the anchor an extension would grow from, and **`data-canvas-drag` on the root**
 * turns selection off for as long as the pointer is down, so a drag that crosses a card's
 * text cannot start one either. Both are reverted on release, so text is selectable at
 * rest.
 */
export function useNoTextSelection(): void {
  useEffect(() => {
    const root = document.documentElement;

    const press = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(SELECTABLE)) return;
      // The anchor goes first: a shift+press extends from it, and no gesture in a canvas
      // wants the selection somebody made a minute ago.
      window.getSelection()?.removeAllRanges();
      root.dataset.canvasDrag = "true";
    };

    const release = () => {
      delete root.dataset.canvasDrag;
    };

    /**
     * A second gate, for the browsers and paths where `user-select: none` on the root
     * does not stop the selection itself: while the press is down, nothing outside an
     * editor may start one.
     */
    const select = (event: Event) => {
      if (root.dataset.canvasDrag === undefined) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(SELECTABLE)) return;
      event.preventDefault();
    };

    window.addEventListener("pointerdown", press, true);
    window.addEventListener("selectstart", select, true);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("selectstart", select, true);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
      delete root.dataset.canvasDrag;
    };
  }, []);
}
