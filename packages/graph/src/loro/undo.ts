import type { DocContext } from "./context.js";

/**
 * Owns undo and redo over the document's `UndoManager`: one commit is one step, and
 * text, init and index origins stay out of the stack so a keystroke is not a step.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function undoMethods(ctx: DocContext) {
  return {
    undo(): void {
      ctx.undoManager.undo();
    },

    redo(): void {
      ctx.undoManager.redo();
    },

    canUndo(): boolean {
      return ctx.undoManager.canUndo();
    },

    canRedo(): boolean {
      return ctx.undoManager.canRedo();
    },

    /** Each commit is already a separate undo item. */
    stopCapturing(): void {},
  };
}
