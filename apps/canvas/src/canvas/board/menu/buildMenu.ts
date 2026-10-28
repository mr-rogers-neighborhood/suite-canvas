import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import { buildEntityMenu } from "./entityMenu";
import type { BoardMenuContext } from "./types";

/**
 * The menu for whatever was right-clicked.
 *
 * There is one table of rows (`entityMenu`) and one rule for reading it: resolve the
 * target, keep the rows that serve it, draw them in group order. A canvas press creates,
 * a link can reverse itself, a card can be restyled — the differences live in the rows
 * that declare those kinds, not in a chain of branches that each own their own markup.
 */
export function buildBoardMenu(ctx: BoardMenuContext): ContextMenuItem[] {
  return buildEntityMenu(ctx);
}
