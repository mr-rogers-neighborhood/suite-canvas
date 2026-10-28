import type { WorkspaceDocument } from "@suite/graph";
import { usePlaceStackStore } from "../canvas/placeStack";
import { useUiStore } from "../store/useUiStore";

/**
 * Undo and redo for structure, with one thing the document cannot know.
 *
 * A placement a stack made is a press the reader is still working through, so undoing it
 * hands the card back to the hand rather than leaving it in the inbox with nothing on
 * screen to explain where it went. Every undo path goes through here — the keyboard, the
 * title bar, the palette and the history panel — because a card that comes back on one
 * route and vanishes on another is worse than one that never comes back.
 *
 * Only placed cards that have left the board come back, and only for cards this stack put
 * down, so an undo that touched something else is silent.
 */
export function undoWithStack(workspace: WorkspaceDocument): void {
  workspace.undo();
  reclaimPlaced(workspace);
}

export function redoWithStack(workspace: WorkspaceDocument): void {
  workspace.redo();
}

function reclaimPlaced(workspace: WorkspaceDocument): void {
  const stack = usePlaceStackStore.getState();
  if (stack.placed.length === 0) return;
  const boardId = useUiStore.getState().activeBoardId;
  if (!boardId) return;
  const missing = stack.placed.filter((id) => workspace.getPlacement(boardId, id) === undefined);
  if (missing.length > 0) stack.reclaim(missing);
}
