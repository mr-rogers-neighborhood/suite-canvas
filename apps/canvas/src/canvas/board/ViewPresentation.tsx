import { resolveContext, type SavedView, sectionForCard, viewKindOf } from "@suite/graph";
import { useMemo } from "react";
import { ViewFigure } from "../../cards/ViewFigure";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useUiStore } from "../../store/useUiStore";
import { useViewsStore } from "../../store/viewsStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";
import { draftToView, PREVIEW_VIEW_ID } from "../../views/draft";

/**
 * A collection or a render, over the board area.
 *
 * A lens is applied to the canvas itself, but a table and a chart are not a place: they take the
 * surface beside the editor, which is why this is a board-area overlay rather than a dialog. It is a
 * *reading* — ADR-0043 lets a database edit cells, and that is deliberately not here yet, so every
 * cell is plain text instead of an input that would not save.
 */
export function ViewPresentation() {
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const presented = useViewsStore((state) => state.presented);
  const draft = useViewsStore((state) => state.draft);
  const preview = useViewsStore((state) => state.preview);
  const present = useViewsStore((state) => state.present);
  const openView = useViewsStore((state) => state.openView);
  const reopenEditor = useViewsStore((state) => state.reopenEditor);
  const activeBoardId = useUiStore((state) => state.activeBoardId);

  const view: SavedView | null = useMemo(() => {
    if (presented === null) return null;
    if (presented === PREVIEW_VIEW_ID && draft !== null) return draftToView(draft);
    if (draft !== null && draft.sourceId === presented) return draftToView(draft);
    return workspace?.getView(presented) ?? null;
  }, [presented, draft, workspace]);

  // The snapshot is what tells this read that the document moved; `resolveContext` reads the rest.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the full snapshot is the invalidation signal.
  const context = useMemo(() => {
    if (workspace === null || view === null) return null;
    return resolveContext(workspace, view, { boardId: activeBoardId });
  }, [workspace, view, activeBoardId, snapshot]);

  if (workspace === null || view === null || context === null) return null;

  const kind = viewKindOf(view);
  const isPreview = preview && draft !== null && view.id === (draft.sourceId ?? PREVIEW_VIEW_ID);

  const rows = context.cardIds.map((cardId) => {
    const card = workspace.getCard(cardId);
    const placement = workspace
      .listPlacements()
      .find((entry) => entry.cardId === cardId && entry.boardId === activeBoardId);
    const section =
      placement === undefined
        ? undefined
        : sectionForCard(placement, workspace.listSections(placement.boardId));
    return {
      id: cardId,
      title: workspace.displayTitle(cardId) || "Untitled",
      type: snapshot.types.find((type) => type.id === card?.primaryTypeId)?.name ?? "card",
      section: section?.title.trim() || "—",
      updated: card?.updatedAt ?? 0,
    };
  });

  return (
    <section
      data-testid="view-presentation"
      data-handbook-region="views-presentation"
      data-preview={isPreview ? "true" : undefined}
      className="absolute inset-0 z-30 flex flex-col bg-[var(--surface)]"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-3 py-1.5">
        <span className="text-[12px] font-medium">
          {isPreview ? `Preview · ${view.name}` : view.name}
        </span>
        <span className="text-[11px] text-[var(--ink-muted)]" data-testid="view-presentation-count">
          {rows.length} {rows.length === 1 ? "card" : "cards"}
          {context.inInbox.length > 0 ? ` · ${context.inInbox.length} in the inbox` : ""}
        </span>
        <button
          type="button"
          data-testid="view-presentation-edit"
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
          onClick={() => (isPreview ? reopenEditor() : openView(view))}
        >
          Edit
        </button>
        <button
          type="button"
          aria-label="Close the view"
          data-testid="view-presentation-close"
          className="rounded px-1.5 py-0.5 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
          onClick={() => present(null)}
        >
          {"\u00d7"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {kind === "render" ? (
          <div className="h-[min(420px,60vh)]">
            <ViewFigure view={view} workspace={workspace} />
          </div>
        ) : kind === "collection" ? (
          view.collection?.mode === "grid" ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-[var(--hairline)] p-2 text-[12px]"
                  data-testid="view-presentation-card"
                >
                  <span className="block truncate">{row.title}</span>
                  <span className="block text-[10px] text-[var(--ink-muted)]">{row.type}</span>
                </li>
              ))}
            </ul>
          ) : view.collection?.mode === "list" ? (
            <ul className="flex flex-col">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2 border-b border-[var(--hairline)] px-1 py-1 text-[12px]"
                  data-testid="view-presentation-card"
                >
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <span className="text-[10px] text-[var(--ink-muted)]">{row.type}</span>
                  <span className="w-24 truncate text-[10px] text-[var(--ink-muted)]">
                    {row.section}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-[var(--hairline)] text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                  <th className="px-1 py-1 font-medium">Card</th>
                  <th className="px-1 py-1 font-medium">Type</th>
                  <th className="px-1 py-1 font-medium">Section</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--hairline)]"
                    data-testid="view-presentation-card"
                  >
                    <td className="max-w-[280px] truncate px-1 py-1">{row.title}</td>
                    <td className="px-1 py-1 text-[var(--ink-muted)]">{row.type}</td>
                    <td className="px-1 py-1 text-[var(--ink-muted)]">{row.section}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <p className="text-[12px] text-[var(--ink-muted)]">
            A lens is drawn on the board itself, not here.
          </p>
        )}
      </div>
    </section>
  );
}
