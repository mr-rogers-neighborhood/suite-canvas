import type { ContextMenuItem } from "../dialogs/ContextMenu";
import { ContextMenu } from "../dialogs/ContextMenu";
import { Dialog } from "../dialogs/Dialog";
import type { LibraryBoard, LibraryItem } from "./libraryTypes";

/** The drawer's portalled extras: delete confirmation, row menu and drag ghost. */
export function LibraryOverlays({
  pendingDelete,
  onDismissDelete,
  onDeleteBoard,
  rowMenu,
  menuItems,
  onCloseMenu,
  hold,
}: {
  pendingDelete: LibraryBoard | null;
  onDismissDelete: () => void;
  onDeleteBoard: (boardId: string, cards: "keep" | "trash") => void;
  rowMenu: { id: string; label: string; x: number; y: number } | null;
  /** The actions for the open row, rebuilt from the row id. */
  menuItems: ContextMenuItem[];
  onCloseMenu: () => void;
  hold: { item: LibraryItem; x: number; y: number } | null;
}) {
  return (
    <>
      {pendingDelete ? (
        <Dialog
          title="Delete board?"
          description={`${pendingDelete.title} has ${pendingDelete.cardCount} ${
            pendingDelete.cardCount === 1 ? "card" : "cards"
          } on it. Unplacing keeps the cards in the library; trashing sends this board's cards to the trash with it.`}
          onClose={onDismissDelete}
          actions={[
            {
              label: "Unplace cards",
              primary: true,
              onSelect: () => onDeleteBoard(pendingDelete.id, "keep"),
            },
            {
              label: "Trash cards",
              danger: true,
              onSelect: () => onDeleteBoard(pendingDelete.id, "trash"),
            },
          ]}
        />
      ) : null}

      {/* One menu for every row, opened by its ⋯ button or by right-clicking it.
      Rendered through the drawer's own portal so it stacks with the drawer
      rather than under the canvas. */}
      {rowMenu ? (
        <ContextMenu x={rowMenu.x} y={rowMenu.y} items={menuItems} onClose={onCloseMenu} />
      ) : null}

      {hold ? (
        <div
          aria-hidden="true"
          data-testid="library-hold-ghost"
          className="library-ghost"
          style={{ left: hold.x, top: hold.y }}
        >
          {hold.item.title}
        </div>
      ) : null}
    </>
  );
}
