import { type RefObject, useEffect } from "react";

/**
 * Where a drag is allowed to select text: an editor, and nothing else.
 *
 * A card's read-only text is part of the picture, not a document to drag across, so it
 * is deliberately absent. `.ProseMirror` is listed even though Tiptap marks it
 * `contenteditable`, because a mismatch between the two would silently break selecting
 * a word inside a card.
 */
const SELECTABLE = "[contenteditable='true'], .ProseMirror, input, textarea";

/**
 * The canvas is not a text surface, so a drag across it selects nothing.
 *
 * Shift is the marquee key here, and the browser reads the same shift as "extend the
 * selection from the last anchor". That anchor is usually a card's own text, so a
 * shift+drag swept every word between it and the pointer — the whole page lighting up
 * blue — and the marquee that was meant to happen looked like it had gone wrong.
 * `pointerdown`'s `preventDefault` does not stop it; `selectstart` is the event the
 * browser asks before it starts, and it fires for the pane and for a card alike.
 *
 * Captured on the board root rather than the pane: the reported gesture usually begins
 * on a card, and a sweep that starts there is the same defect.
 */
export function useNoTextSelection(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const cancel = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(SELECTABLE)) return;
      event.preventDefault();
    };
    node.addEventListener("selectstart", cancel, true);
    return () => node.removeEventListener("selectstart", cancel, true);
  }, [root]);
}
