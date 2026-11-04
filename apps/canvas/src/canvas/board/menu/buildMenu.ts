import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import type { BoardMenuContext } from "./types";
import { buildVerbMenu } from "./verbs";

/**
 * The menu for whatever was right-clicked.
 *
 * There is one table of verbs (`verbs`) and one rule for reading it: resolve the target, keep the verbs
 * that serve it, draw them in group order. A canvas press creates, a link can reverse itself, a card can
 * be restyled — the differences live in the verbs that declare those kinds, not in a chain of branches
 * that each own their own markup.
 *
 * This module is the adapter and nothing else: the table is the truth, and the keyboard, the palette and
 * the panels read the same table rather than keeping a second copy of what a thing can have done to it.
 */
export function buildBoardMenu(ctx: BoardMenuContext): ContextMenuItem[] {
  return buildVerbMenu(ctx);
}
