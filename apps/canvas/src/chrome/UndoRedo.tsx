import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * Undo and redo beside the board tabs, where the rest of the navigation lives.
 *
 * Structure undo lived on `Mod+Z` alone, which meant it existed only for a reader
 * who already knew it existed. The pair reads the document's own undo manager, so
 * the disabled state is the truth rather than a guess, and it subscribes to the
 * snapshot so a change anywhere repaints the pair.
 */
export function UndoRedo() {
  const workspace = useCanvasStore((state) => state.workspace);
  // A subscription, not a value: the render has to happen when the document
  // changes, so the two `can*` reads below are current.
  useWorkspaceSnapshot();

  const step = (direction: "undo" | "redo") => {
    const ui = useUiStore.getState();
    if (direction === "undo") workspace.undo();
    else workspace.redo();
    // A card that just disappeared must not stay selected or under the caret.
    ui.setSelectedNodeIds([]);
    ui.stopEditing();
  };

  return (
    <span className="flex shrink-0 items-center" data-testid="nav-history">
      <button
        type="button"
        data-testid="nav-undo"
        aria-label="Undo"
        title="Undo (⌘Z)"
        className="board-nav-button"
        disabled={!workspace.canUndo()}
        onClick={() => step("undo")}
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          {"\u21b6"}
        </span>
      </button>
      <button
        type="button"
        data-testid="nav-redo"
        aria-label="Redo"
        title="Redo (⌘⇧Z)"
        className="board-nav-button"
        disabled={!workspace.canRedo()}
        onClick={() => step("redo")}
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          {"\u21b7"}
        </span>
      </button>
    </span>
  );
}
