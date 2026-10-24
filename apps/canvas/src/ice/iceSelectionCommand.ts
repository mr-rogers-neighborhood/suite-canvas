/**
 * The surface's own selection path, for the shell.
 *
 * Suite owns the selection (`useIceSelection` mirrors ICE's `Selected` set into
 * the store), but a shell action can also *ask* for one: "Select N cards" in a
 * Board's menu writes the store and must make ICE agree, or the next frame
 * mirrors an empty desk selection back over it and the highlighting lies.
 *
 * The engine lives inside the surface's gesture hook, and the menu is a sibling
 * React component with no reference to it, so this module is the one handle
 * between them: the gesture registers the writer while it is attached, the menu
 * calls it, and an unmounted surface leaves `null` so a menu that outlives it
 * (a stale click) does nothing rather than throwing.
 *
 * It is not a second source of truth: the store stays the answer to "what is
 * selected", and this only tells the engine to draw the same set.
 */

/** Card ids → the desk's `Selected` set. Registered by the surface, one at a time. */
export type IceSelectionCommand = (cardIds: readonly string[]) => void;

let command: IceSelectionCommand | null = null;

/** Installs the surface's writer; pass `null` on teardown. */
export function setIceSelectionCommand(next: IceSelectionCommand | null): void {
  command = next;
}

/**
 * Select these cards on the desk. False when no surface is attached, which is a
 * shell that outlived its canvas (tests, a closing tab) — never an error.
 */
export function selectCardsInIce(cardIds: readonly string[]): boolean {
  if (command === null) return false;
  command(cardIds);
  return true;
}
