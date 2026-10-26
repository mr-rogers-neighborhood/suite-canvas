import { runViewQuery, type SavedView, type ViewQuery, type WorkspaceDocument } from "@suite/graph";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { UNSORTED_SECTION } from "./libraryFilters";

/**
 * Saved views live in their own root map, outside the snapshot sections a board
 * or card write touches, so the menu subscribes to that map alone.
 */
export function useSavedViews(workspace: WorkspaceDocument | null | undefined): SavedView[] {
  const subscribe = useCallback(
    (onChange: () => void) => (workspace ? workspace.observeViews(onChange) : () => {}),
    [workspace],
  );
  const getSnapshot = useCallback(() => workspace?.viewsRevision ?? 0, [workspace]);
  const revision = useSyncExternalStore(subscribe, getSnapshot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision is the invalidation signal.
  return useMemo(() => (workspace ? workspace.listViews() : []), [workspace, revision]);
}

export interface ViewsBarProps {
  /** Defaults to the live document in the canvas store. */
  workspace?: WorkspaceDocument | null;
  /**
   * Place a view's result as a run ([ADR-0063](../../../docs/decisions/0063-placement-is-a-mode-too.md)).
   * The view's own sorts decide the order, so a threaded run follows the list the
   * user is looking at.
   */
  onPlaceResults?: ((cardIds: readonly string[]) => void) | undefined;
  /**
   * Saving, renaming and deleting a view is workspace configuration, so it is
   * gated by `canManageSchema` by default; tests and stories may override.
   */
  canManage?: boolean;
}

/**
 * Facet ids whose record disappeared are dropped on the way into the library,
 * the same rule `runView` applies, so an applied view and a computed one select
 * the same cards.
 */
function appliedQuery(workspace: WorkspaceDocument, query: ViewQuery): ViewQuery {
  return {
    ...query,
    typeIds: query.typeIds.filter((id) => workspace.getType(id) !== undefined),
    tagIds: query.tagIds.filter((id) => workspace.getTag(id) !== undefined),
    sectionIds: query.sectionIds.filter(
      (id) => id === UNSORTED_SECTION || workspace.getSection(id) !== undefined,
    ),
  };
}

/** The name a save starts with: the search text, then a numbered fallback. */
function suggestedName(text: string, count: number): string {
  const trimmed = text.trim();
  if (trimmed.length > 0) return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
  return `View ${count + 1}`;
}

/**
 * Saved query views in the app bar, beside the board tabs. A view is a stored
 * query, so opening one copies it into the library's own controls; nothing is
 * cached and no result list is stored.
 */
export function ViewsBar({
  workspace: workspaceProp = null,
  canManage,
  onPlaceResults,
}: ViewsBarProps) {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = workspaceProp ?? storeWorkspace;
  const views = useSavedViews(workspace);

  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const canManageViews = canManage ?? canManageSchema;
  const applyView = useUiStore((state) => state.applyView);
  const exitView = useUiStore((state) => state.exitView);
  const activeViewId = useUiStore((state) => state.activeViewId);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const query = useUiStore((state) => state.libraryQuery);
  const typeFilter = useUiStore((state) => state.libraryTypeFilter);
  const tagFilter = useUiStore((state) => state.libraryTagFilter);
  const sectionFilter = useUiStore((state) => state.librarySectionFilter);
  const scope = useUiStore((state) => state.libraryScope);
  const groupBySection = useUiStore((state) => state.libraryGroupBySection);

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const container = useRef<HTMLDivElement | null>(null);

  const activeView = views.find((view) => view.id === activeViewId);
  const hasSearch = query.trim().length > 0;
  const hasFacets = typeFilter.length > 0 || tagFilter.length > 0 || sectionFilter.length > 0;
  const canSaveCurrent = canManageViews && (hasSearch || hasFacets);

  const close = useCallback(() => {
    setOpen(false);
    setSaving(false);
    setRenamingId(null);
    setConfirmId(null);
  }, []);

  useEscapeLayer(close, open);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (container.current?.contains(event.target as Node)) return;
      close();
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open, close]);

  // A view whose query is the current search is saved from these same controls:
  // there is no separate query builder to keep in sync.
  const save = () => {
    if (!workspace || !canManageViews) return;
    const name = draft.trim();
    if (name.length === 0) return;
    const text = query.trim();
    const saved: ViewQuery = {
      ...(text.length > 0 ? { text } : {}),
      typeIds: [...typeFilter],
      tagIds: [...tagFilter],
      // Sections only mean something inside one board's namespace, so a global
      // view never stores them: the library has no section facet there.
      sectionIds: scope === "board" ? [...sectionFilter] : [],
      scope,
      groupBySection,
      order: text.length > 0 ? "relevance" : "title",
    };
    const created = workspace.createView({ name, query: saved });
    applyView(created.id, appliedQuery(workspace, created.query));
    close();
  };

  const onDraftKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSaving(false);
    }
  };

  const rename = (view: SavedView) => {
    if (!workspace || !canManageViews) return;
    const name = draft.trim();
    if (name.length === 0) {
      setRenamingId(null);
      return;
    }
    workspace.updateView(view.id, { name });
    setRenamingId(null);
  };

  return (
    <div ref={container} className="relative flex min-w-0 items-center" data-testid="views-bar">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="views-menu-button"
        data-active={activeView ? "true" : undefined}
        title={activeView ? `View: ${activeView.name}` : "Saved views"}
        className="views-bar__button inline-flex h-6 max-w-[160px] items-center truncate px-0 text-[12px] leading-none text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {activeView ? activeView.name : "Views"}
        <span aria-hidden="true" className="ml-1.5 text-[12px] leading-none opacity-80">
          {"\u25b8"}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Saved views"
          data-testid="views-menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[200px] max-w-[260px] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
        >
          {views.length === 0 ? (
            <p
              className="px-3 py-1.5 text-[12px] text-[var(--ink-muted)]"
              data-testid="views-empty"
            >
              No saved views
            </p>
          ) : (
            views.map((view) => (
              <div key={view.id} className="rounded hover:bg-black/5 dark:hover:bg-white/10">
                {renamingId === view.id ? (
                  <div className="flex items-center gap-1 px-2 py-1">
                    <input
                      // biome-ignore lint/a11y/noAutofocus: inline rename is an explicit gesture
                      autoFocus
                      value={draft}
                      aria-label={`Rename ${view.name}`}
                      data-testid="views-rename-input"
                      className="w-28 rounded px-1.5 py-1 text-[12px] outline-none ring-1 ring-blue-400"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") rename(view);
                        if (event.key === "Escape") setRenamingId(null);
                      }}
                    />
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => rename(view)}
                    >
                      Save
                    </button>
                  </div>
                ) : confirmId === view.id ? (
                  <div className="flex items-center gap-1 px-2 py-1 text-[12px]">
                    <span className="min-w-0 flex-1 truncate">Delete “{view.name}”?</span>
                    <button
                      type="button"
                      data-testid="views-delete-confirm"
                      className="rounded px-1.5 py-1 text-[11px] text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15"
                      onClick={() => {
                        workspace?.deleteView(view.id);
                        if (activeViewId === view.id) exitView();
                        setConfirmId(null);
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => setConfirmId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`views-item-${view.id}`}
                      data-active={activeViewId === view.id ? "true" : undefined}
                      className="min-w-0 flex-1 truncate rounded px-3 py-1.5 text-left text-[12px]"
                      onClick={() => {
                        if (workspace) applyView(view.id, appliedQuery(workspace, view.query));
                        close();
                      }}
                    >
                      {view.name}
                      {activeViewId === view.id ? (
                        <span aria-hidden="true" className="ml-1 opacity-60">
                          {"\u2713"}
                        </span>
                      ) : null}
                    </button>
                    {onPlaceResults ? (
                      <button
                        type="button"
                        role="menuitem"
                        data-testid={`views-place-${view.id}`}
                        title="Place this view's cards on the board, in its own order"
                        className="rounded px-1.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => {
                          // Resolved on the click, never cached: a view selects, it
                          // does not store a result list (ADR-0043).
                          const result = runViewQuery(
                            workspace,
                            appliedQuery(workspace, view.query),
                            { boardId: activeBoardId },
                          );
                          onPlaceResults(result.cardIds);
                          close();
                        }}
                      >
                        Place
                      </button>
                    ) : null}
                    {canManageViews ? (
                      <>
                        <button
                          type="button"
                          aria-label={`Rename ${view.name}`}
                          data-testid={`views-rename-${view.id}`}
                          className="rounded px-1.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={() => {
                            setRenamingId(view.id);
                            setDraft(view.name);
                            setConfirmId(null);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${view.name}`}
                          data-testid={`views-delete-${view.id}`}
                          className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={() => setConfirmId(view.id)}
                        >
                          {"\u00d7"}
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))
          )}

          {canSaveCurrent && !saving ? (
            <button
              type="button"
              role="menuitem"
              data-testid="views-save"
              className="mt-1 w-full rounded border-t border-[var(--hairline)] px-3 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                setSaving(true);
                setDraft(suggestedName(query, views.length));
                setRenamingId(null);
                setConfirmId(null);
              }}
            >
              Save current search as view…
            </button>
          ) : null}

          {saving ? (
            <div className="mt-1 flex items-center gap-1 border-t border-[var(--hairline)] px-2 py-1.5">
              <input
                // biome-ignore lint/a11y/noAutofocus: the save prompt is an explicit gesture
                autoFocus
                value={draft}
                aria-label="View name"
                data-testid="views-save-input"
                placeholder="View name"
                className="min-w-0 flex-1 rounded px-1.5 py-1 text-[12px] outline-none ring-1 ring-blue-400"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onDraftKey}
              />
              <button
                type="button"
                data-testid="views-save-commit"
                className="rounded px-1.5 py-1 text-[11px] font-medium hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                disabled={draft.trim().length === 0}
                onClick={save}
              >
                Save
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-1 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setSaving(false)}
              >
                Cancel
              </button>
            </div>
          ) : null}

          {activeViewId ? (
            <button
              type="button"
              role="menuitem"
              data-testid="views-exit"
              className="mt-1 w-full rounded border-t border-[var(--hairline)] px-3 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                exitView();
                close();
              }}
            >
              Exit view
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
