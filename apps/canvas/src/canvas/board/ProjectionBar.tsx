import { resolveContext } from "@suite/graph";
import { useMemo } from "react";
import { useProjectionStore } from "../../store/projectionStore";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useUiStore } from "../../store/useUiStore";
import { useViewsStore } from "../../store/viewsStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";
import { useCanvasLens } from "../useCanvasLens";

/**
 * What is projected, and how to leave it.
 *
 * A projection is this reader's, so the bar offers *this* reader's two ways out: stop projecting, or open
 * the layer on the same view and change it. It is also the only place a multi-board context explains
 * itself: the chips are the boards the context touches, and the inbox count says how much of it has no
 * position to outline.
 */
export function ProjectionBar() {
  const lens = useCanvasLens();
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const activateBoard = useUiStore((state) => state.activateBoard);
  const stop = useProjectionStore((state) => state.stop);
  const setToggles = useProjectionStore((state) => state.setToggles);
  const openLayer = useViewsStore((state) => state.openLayer);

  const view = lens.view;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot is the invalidation signal.
  const context = useMemo(() => {
    if (workspace === null || view === null) return null;
    return resolveContext(workspace, view, { boardId: activeBoardId });
  }, [workspace, view, activeBoardId, snapshot]);

  if (view === null || context === null) return null;

  const here = activeBoardId === null ? 0 : (context.byBoard.get(activeBoardId) ?? 0);

  return (
    <div
      data-testid="projection-bar"
      data-handbook-region="views-projection-bar"
      className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex max-w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1 text-[11px] shadow-lg"
    >
      <span className="font-medium text-[var(--ink)]" data-testid="projection-bar-name">
        {view.name}
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
            data-testid={`projection-bar-board-${boardId}`}
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
          data-testid="projection-bar-inbox"
          title="These cards are in the inbox: they are in the view, but a board has no place to show them."
          className="rounded-full px-1.5 py-0.5 text-[var(--ink-muted)]"
        >
          {context.inInbox.length} in the inbox
        </span>
      ) : null}
      <button
        type="button"
        data-testid="projection-bar-outline"
        aria-pressed={lens.outline}
        title="Outline the cards this view selects"
        className={`rounded-full px-1.5 py-0.5 ${
          lens.outline
            ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
            : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
        }`}
        onClick={() => setToggles({ outline: !lens.outline })}
      >
        Outline
      </button>
      <button
        type="button"
        data-testid="projection-bar-fade"
        aria-pressed={lens.fade}
        title="Fade everything this view does not select"
        className={`rounded-full px-1.5 py-0.5 ${
          lens.fade
            ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
            : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
        }`}
        onClick={() => setToggles({ fade: !lens.fade })}
      >
        Fade
      </button>
      <button
        type="button"
        data-testid="projection-bar-open"
        className="rounded px-1.5 py-0.5 text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
        onClick={() => openLayer(view.id)}
      >
        Open
      </button>
      <button
        type="button"
        aria-label="Stop projecting"
        data-testid="projection-bar-stop"
        className="rounded px-1.5 py-0.5 text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
        onClick={stop}
      >
        {"\u00d7"}
      </button>
    </div>
  );
}
