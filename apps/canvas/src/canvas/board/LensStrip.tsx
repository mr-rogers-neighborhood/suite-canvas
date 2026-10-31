import { resolveContext } from "@suite/graph";
import { useMemo } from "react";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useUiStore } from "../../store/useUiStore";
import { useViewsStore } from "../../store/viewsStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";
import { useCanvasLens } from "../useCanvasLens";

/**
 * What a lens is doing, and how to leave it.
 *
 * A lens highlights its context on one board, but a context can span several — so the strip says how
 * many of the cards are here, and offers the boards that hold the rest rather than guessing which one
 * the reader meant. Cards in the inbox are named and not offered: an unplaced card has no position to
 * outline, and pretending otherwise would be a chip that does nothing.
 *
 * It is also where a draft is honest about being one: while the preview is on, the name reads
 * `Preview · …` and Edit goes back to the sheet. Nothing here writes.
 */
export function LensStrip() {
  const lens = useCanvasLens();
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const activateBoard = useUiStore((state) => state.activateBoard);
  const exitView = useUiStore((state) => state.exitView);
  const draft = useViewsStore((state) => state.draft);
  const preview = useViewsStore((state) => state.preview);
  const reopenEditor = useViewsStore((state) => state.reopenEditor);
  const discard = useViewsStore((state) => state.discard);
  const pendingCardId = useViewsStore((state) => state.pendingCardId);

  const view = lens.view;
  // The snapshot is what tells this read that the document moved (a card trashed, a board renamed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the full snapshot is the invalidation signal.
  const context = useMemo(() => {
    if (workspace === null || view === null) return null;
    return resolveContext(workspace, view, { boardId: activeBoardId });
  }, [workspace, view, activeBoardId, snapshot]);

  if (view === null || context === null) return null;

  const isPreview = preview && draft !== null;
  const here = activeBoardId === null ? 0 : (context.byBoard.get(activeBoardId) ?? 0);

  const clear = () => {
    // Clearing a preview that came from a new view card takes the card with it, for the same reason
    // Cancel does: nothing was saved, so nothing should be left on the board.
    if (pendingCardId !== null && workspace !== null) workspace.trashCard(pendingCardId);
    discard();
    exitView();
  };

  return (
    <div
      data-testid="lens-strip"
      data-preview={isPreview ? "true" : undefined}
      className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1 text-[11px] shadow-lg"
    >
      <span className="font-medium text-[var(--ink)]" data-testid="lens-strip-name">
        {isPreview ? `Preview · ${view.name}` : view.name}
      </span>
      <span className="tabular-nums text-[var(--ink-muted)]">
        {here} on this board · {context.cardIds.length}{" "}
        {context.cardIds.length === 1 ? "card" : "cards"}
      </span>
      {[...context.byBoard.entries()].map(([boardId, count]) => {
        const board = snapshot.boards.find((entry) => entry.id === boardId);
        if (board === undefined) return null;
        return (
          <button
            key={boardId}
            type="button"
            data-testid={`lens-strip-board-${boardId}`}
            aria-pressed={boardId === activeBoardId}
            className={`rounded-full px-1.5 py-0.5 ${
              boardId === activeBoardId
                ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
            onClick={() => activateBoard(boardId)}
          >
            {board.name} · {count}
          </button>
        );
      })}
      {context.inInbox.length > 0 ? (
        <span
          data-testid="lens-strip-inbox"
          title="These cards are in the inbox: they are in the view, but a board has no place to show them."
          className="rounded-full px-1.5 py-0.5 text-[var(--ink-muted)]"
        >
          {context.inInbox.length} in the inbox
        </span>
      ) : null}
      {isPreview ? (
        <button
          type="button"
          data-testid="lens-strip-edit"
          className="rounded px-1.5 py-0.5 text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
          onClick={reopenEditor}
        >
          Edit
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Clear the lens"
        data-testid="lens-strip-clear"
        className="rounded px-1.5 py-0.5 text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
        onClick={clear}
      >
        {"\u00d7"}
      </button>
    </div>
  );
}
