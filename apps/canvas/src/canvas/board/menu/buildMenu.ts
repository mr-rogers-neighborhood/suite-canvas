import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import { canvasMenuBranch, sectionMenuBranch } from "./containerMenu";
import { connectorMenuBranch, edgeMenuBranch } from "./linkMenu";
import { nodeMenuBranch, selectionMenuBranch } from "./nodeMenu";
import type { BoardMenuContext } from "./types";

/**
 * The menu for whatever was right-clicked. Branches run in the order a click can
 * mean them — the canvas, a section, a link, a connector, a multi-selection —
 * and the first one that applies wins; a plain card is the fallback.
 */
export function buildBoardMenu(ctx: BoardMenuContext): ContextMenuItem[] {
  const branches = [
    canvasMenuBranch,
    sectionMenuBranch,
    edgeMenuBranch,
    connectorMenuBranch,
    selectionMenuBranch,
  ];
  for (const branch of branches) {
    const items = branch(ctx);
    if (items !== null) return items;
  }
  return nodeMenuBranch(ctx) ?? [];
}
