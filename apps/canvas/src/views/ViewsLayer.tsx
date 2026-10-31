import type { SavedView, ViewKind, ViewQuery } from "@suite/graph";
import { viewKindOf } from "@suite/graph";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ViewFigure } from "../cards/ViewFigure";
import { VIEW_CARD_FIELD_ID } from "../cards/viewCard";
import { useSavedViews } from "../chrome/ViewsBar";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import { PROJECTION_KEY, useProjectionStore } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { draftToView } from "./draft";
import { ViewSurface } from "./ViewSurface";
import { ViewsContextDrawer } from "./ViewsContextDrawer";
import { ViewsPickingBar } from "./ViewsPickingBar";
import "../styles/views.css";

const KIND_LABEL: Record<ViewKind, string> = {
  collection: "Collection",
  render: "Render",
  // A legacy kind: readable, never offered.
  lens: "Lens",
};

interface OpenedSnapshot {
  readonly id: string;
  readonly name: string;
  readonly query: ViewQuery;
  readonly kind: ViewKind;
  readonly collection: SavedView["collection"];
  readonly render: SavedView["render"];
  readonly pins: readonly string[];
}

/**
 * The views layer: a mode, not a panel.
 *
 * It takes the window because a view is a surface, not a drawer: the rail of saved views, the presentation
 * of the one you are reading, and the context that produced it. A *saved* view is edited in place through
 * the document's field-level setters, so collaborators see each change as it happens; a *new* view is a
 * draft until its first Create, because there is nothing to share before that.
 *
 * Picking is the layer's third state: it steps out of the window, the board becomes the surface, and the
 * bar at the bottom owns Done and Cancel.
 */
export function ViewsLayer() {
  const workspace = useCanvasStore((state) => state.workspace);
  const open = useViewsStore((state) => state.open);
  const picking = useViewsStore((state) => state.picking);
  const editingId = useViewsStore((state) => state.editingId);
  const draft = useViewsStore((state) => state.draft);
  const contextOpen = useViewsStore((state) => state.contextOpen);
  const pendingCardId = useViewsStore((state) => state.pendingCardId);
  const openLayer = useViewsStore((state) => state.openLayer);
  const openNew = useViewsStore((state) => state.openNew);
  const close = useViewsStore((state) => state.close);
  const toggleContext = useViewsStore((state) => state.toggleContext);
  const setDraft = useViewsStore((state) => state.setDraft);
  const created = useViewsStore((state) => state.created);
  const startPicking = useViewsStore((state) => state.startPicking);

  const views = useSavedViews(workspace);
  const projection = useProjectionStore((state) => state.project);
  const stopProjection = useProjectionStore((state) => state.stop);
  const projectedId = useProjectionStore(
    (state) => state.byWorkspace[PROJECTION_KEY]?.viewId ?? null,
  );
  const snapshot = useWorkspaceSnapshot();
  const boardId = useUiStore((state) => state.activeBoardId);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const focusCard = useUiStore((state) => state.focusCard);

  const panel = useRef<HTMLDivElement | null>(null);
  const opened = useRef<OpenedSnapshot | null>(null);
  const [filter, setFilter] = useState("");
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const saved = editingId === null ? undefined : views.find((view) => view.id === editingId);
  const view: SavedView | undefined = saved ?? (draft === null ? undefined : draftToView(draft));

  // What "Discard my edits" restores: the record as it was when this view was opened.
  useEffect(() => {
    if (editingId === null || workspace === null) {
      opened.current = null;
      return;
    }
    const record = workspace.getView(editingId);
    opened.current =
      record === undefined
        ? null
        : {
            id: record.id,
            name: record.name,
            query: record.query,
            kind: viewKindOf(record),
            collection: record.collection,
            render: record.render,
            pins: record.context?.cardIds ?? [],
          };
  }, [editingId, workspace]);

  useEscapeLayer(close, open && !picking);
  useFocusTrap(panel, open && !picking);

  const writeQuery = useCallback(
    (patch: Partial<ViewQuery>) => {
      if (saved !== undefined && workspace !== null) workspace.patchViewQuery(saved.id, patch);
      else if (draft !== null) setDraft({ query: { ...draft.query, ...patch } });
    },
    [saved, workspace, draft, setDraft],
  );

  const rename = useCallback(
    (name: string) => {
      setNameDraft(null);
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      if (saved !== undefined && workspace !== null) workspace.renameView(saved.id, trimmed);
      else if (draft !== null) setDraft({ name: trimmed });
    },
    [saved, workspace, draft, setDraft],
  );

  const setKind = useCallback(
    (kind: "collection" | "render") => {
      if (saved !== undefined && workspace !== null) {
        workspace.setViewKind(
          saved.id,
          kind,
          kind === "render"
            ? { render: saved.render ?? { layout: "graph-2d" } }
            : { collection: saved.collection ?? { mode: "database" } },
        );
        return;
      }
      if (draft !== null) setDraft({ kind });
    },
    [saved, workspace, draft, setDraft],
  );

  const pin = useCallback(
    (cardId: string) => {
      if (saved !== undefined && workspace !== null) workspace.addViewPin(saved.id, cardId);
      else if (draft !== null && !draft.cardIds.includes(cardId)) {
        setDraft({ cardIds: [...draft.cardIds, cardId] });
      }
    },
    [saved, workspace, draft, setDraft],
  );

  const unpin = useCallback(
    (cardId: string) => {
      if (saved !== undefined && workspace !== null) workspace.removeViewPin(saved.id, cardId);
      else if (draft !== null) setDraft({ cardIds: draft.cardIds.filter((id) => id !== cardId) });
    },
    [saved, workspace, draft, setDraft],
  );

  if (!open) return null;

  if (picking) {
    return <ViewsPickingBar view={saved ?? null} workspace={workspace} />;
  }

  if (view === undefined || workspace === null) {
    return createPortal(
      <div className="views-layer fixed inset-0 z-[60] flex items-center justify-center bg-[var(--surface)]">
        <p className="text-[12px] text-[var(--ink-muted)]">
          No views yet.{" "}
          <button type="button" className="underline" onClick={() => openNew(0)}>
            Make one
          </button>
        </p>
      </div>,
      document.body,
    );
  }

  const pins = view.context?.cardIds ?? [];
  const visible = views.filter((entry) =>
    filter.trim().length === 0
      ? true
      : entry.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
  );

  const discardMine = () => {
    const base = opened.current;
    if (base === null || workspace === null) return;
    workspace.renameView(base.id, base.name);
    workspace.patchViewQuery(base.id, base.query);
    workspace.setViewKind(base.id, base.kind === "lens" ? "collection" : base.kind, {
      ...(base.collection === undefined ? {} : { collection: base.collection }),
      ...(base.render === undefined ? {} : { render: base.render }),
    });
    workspace.clearViewPins(base.id);
    for (const cardId of base.pins) workspace.addViewPin(base.id, cardId);
  };

  const createDraft = () => {
    if (draft === null || workspace === null || !canManageSchema) return;
    const record = workspace.createView({
      name: draft.name.trim() || "Untitled view",
      query: draft.query,
      kind: draft.kind,
      context: { cardIds: [...draft.cardIds] },
      collection: draft.collection,
      render: draft.render,
    });
    if (pendingCardId !== null) workspace.setProperty(pendingCardId, VIEW_CARD_FIELD_ID, record.id);
    created(record.id);
  };

  const cancelDraft = () => {
    if (pendingCardId !== null && workspace !== null) workspace.trashCard(pendingCardId);
    close();
  };

  const projectIt = () => {
    if (draft !== null) {
      // Projecting something that does not exist yet would leave a bar naming a draft, so a draft is
      // created first: one press either way, and the record is what everyone else can open.
      createDraft();
      return;
    }
    if (saved === undefined) return;
    projection(saved.id);
    close();
  };

  const startPick = () => startPicking(pins);

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Views"
      data-testid="views-layer"
      data-handbook-region="views-layer"
      className="views-layer fixed inset-0 z-[60] flex flex-col bg-[var(--surface)]"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-3 py-2">
        <span aria-hidden="true" className="text-[var(--accent)]">
          {"\u25c8"}
        </span>
        <input
          className="min-w-0 max-w-[260px] flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium text-[var(--ink)] hover:border-[var(--hairline)] focus:border-[var(--ink-muted)] focus:outline-none"
          aria-label="View name"
          data-testid="views-layer-name"
          value={nameDraft ?? view.name}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={(event) => rename(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setNameDraft(null);
          }}
        />
        <span className="text-[11px] text-[var(--ink-muted)]" data-testid="views-layer-count">
          {pins.length} pinned
        </span>

        <fieldset className="ml-2 flex items-center gap-1">
          <legend className="sr-only">Kind</legend>
          {(["collection", "render"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`views-layer-kind-${kind}`}
              aria-pressed={viewKindOf(view) === kind}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                viewKindOf(view) === kind
                  ? "bg-[var(--ink)] text-[var(--surface)]"
                  : "bg-[var(--segmented-bg)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
              onClick={() => setKind(kind)}
            >
              {KIND_LABEL[kind]}
            </button>
          ))}
        </fieldset>

        <div className="ml-auto flex items-center gap-1">
          <div className="hidden h-9 w-14 overflow-hidden rounded border border-[var(--hairline)] md:block">
            <ViewFigure view={view} workspace={workspace} />
          </div>
          <button
            type="button"
            data-testid="views-layer-project"
            className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={projectIt}
          >
            {saved !== undefined && projectedId === saved.id ? "Projected" : "Project"}
          </button>
          {saved !== undefined && projectedId === saved.id ? (
            <button
              type="button"
              data-testid="views-layer-unproject"
              className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={stopProjection}
            >
              Stop
            </button>
          ) : null}
          <button
            type="button"
            data-testid="views-layer-pick"
            className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
            onClick={startPick}
          >
            Pick cards
          </button>
          <button
            type="button"
            aria-label="Close the views layer"
            data-testid="views-layer-close"
            className="rounded px-1.5 py-0.5 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            onClick={close}
          >
            {"\u00d7"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-44 shrink-0 flex-col border-r border-[var(--hairline)]"
          aria-label="Saved views"
        >
          <div className="flex flex-col gap-1 border-b border-[var(--hairline)] p-2">
            <button
              type="button"
              data-testid="views-layer-new"
              className="w-full rounded-md border border-[var(--hairline)] px-2 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => openNew(views.length)}
            >
              New view
            </button>
            <input
              className="w-full rounded border border-[var(--hairline)] bg-transparent px-1.5 py-0.5 text-[11px] text-[var(--ink)]"
              aria-label="Filter views"
              placeholder="Filter…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1" data-testid="views-layer-rail">
            {visible.length === 0 ? (
              <li className="px-2 py-1 text-[11px] text-[var(--ink-muted)]">No views match.</li>
            ) : null}
            {visible.map((entry) => {
              const active = entry.id === editingId;
              return (
                <li key={entry.id} className="mb-1">
                  <button
                    type="button"
                    data-testid={`views-layer-rail-${entry.id}`}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full flex-col gap-1 rounded-lg border p-1 text-left ${
                      active
                        ? "border-[var(--ink-muted)] bg-[var(--segmented-bg)]"
                        : "border-transparent hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                    onClick={() => openLayer(entry.id)}
                  >
                    <span className="pointer-events-none h-14 overflow-hidden rounded border border-[var(--hairline)]">
                      <ViewFigure view={entry} workspace={workspace} />
                    </span>
                    <span className="flex items-center gap-1 text-[11px]">
                      <span aria-hidden="true" className="opacity-60">
                        {"\u25a6"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    </span>
                    <span className="text-[10px] text-[var(--ink-muted)]">
                      {KIND_LABEL[viewKindOf(entry)]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="relative min-w-0 flex-1 overflow-hidden p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <button
              type="button"
              data-testid="views-layer-context"
              aria-pressed={contextOpen}
              className="rounded-full bg-[var(--segmented-bg)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              onClick={() => toggleContext()}
            >
              Context{contextOpen ? " \u25be" : " \u25b8"}
            </button>
            {view.query.text ? (
              <span className="rounded-full bg-[var(--segmented-bg)] px-1.5 text-[10px]">
                “{view.query.text}”
              </span>
            ) : null}
            {view.query.typeIds.length + view.query.tagIds.length + view.query.sectionIds.length >
            0 ? (
              <span className="rounded-full bg-[var(--segmented-bg)] px-1.5 text-[10px]">
                {view.query.typeIds.length +
                  view.query.tagIds.length +
                  view.query.sectionIds.length}{" "}
                filters
              </span>
            ) : null}
            {pins.length > 0 ? (
              <span className="rounded-full bg-[var(--segmented-bg)] px-1.5 text-[10px]">
                {pins.length} pinned
              </span>
            ) : null}
            {view.query.scope === "board" ? (
              <span className="rounded-full bg-[var(--segmented-bg)] px-1.5 text-[10px]">
                this board
              </span>
            ) : null}
          </div>

          <SurfaceControls
            view={view}
            onCollection={(collection) => {
              if (saved !== undefined && workspace !== null) {
                workspace.patchViewCollection(saved.id, collection);
                return;
              }
              if (draft !== null) setDraft({ collection });
            }}
            onRender={(render) => {
              if (saved !== undefined && workspace !== null) {
                workspace.patchViewRender(saved.id, render);
                return;
              }
              if (draft !== null) setDraft({ render });
            }}
          />

          <div className="h-[calc(100%-4rem)] min-h-0 overflow-auto">
            <ViewSurface
              view={view}
              workspace={workspace}
              boardId={boardId}
              onOpenCard={(cardId) => {
                close();
                if (boardId !== null) focusCard(cardId, boardId);
              }}
            />
          </div>

          {contextOpen ? (
            <ViewsContextDrawer
              view={view}
              workspace={workspace}
              boardId={boardId}
              onQuery={writeQuery}
              onPin={pin}
              onUnpin={unpin}
              onPick={startPick}
              onClose={() => toggleContext(false)}
            />
          ) : null}
        </main>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--hairline)] px-3 py-1.5 text-[11px] text-[var(--ink-muted)]">
        <span>
          {snapshot.boards.length} {snapshot.boards.length === 1 ? "board" : "boards"} ·{" "}
          {snapshot.cards.length} cards
        </span>
        <span className="ml-auto flex items-center gap-1">
          {draft === null ? (
            <>
              <button
                type="button"
                data-testid="views-layer-discard"
                className="rounded px-2 py-1 hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                onClick={discardMine}
              >
                Discard my edits
              </button>
              <button
                type="button"
                data-testid="views-layer-done"
                className="rounded-md bg-[var(--ink)] px-2.5 py-1 font-medium text-[var(--surface)]"
                onClick={close}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="views-layer-cancel"
                className="rounded px-2 py-1 hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                onClick={cancelDraft}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="views-layer-create"
                className="rounded-md bg-[var(--ink)] px-2.5 py-1 font-medium text-[var(--surface)] disabled:opacity-40"
                onClick={createDraft}
                disabled={!canManageSchema}
              >
                Create
              </button>
            </>
          )}
        </span>
      </footer>
    </div>,
    document.body,
  );
}

/**
 * The controls the kind needs: a collection's mode, or a render's layout and measure.
 *
 * They sit above the surface rather than in the context drawer because they describe *how the result is
 * read*, which is the layer's job, not the query's. Every press writes one key through the document's
 * setters, so a collaborator sees the same table become a grid at the same moment this reader does.
 */
function SurfaceControls({
  view,
  onCollection,
  onRender,
}: {
  view: SavedView;
  onCollection: (collection: NonNullable<SavedView["collection"]>) => void;
  onRender: (render: NonNullable<SavedView["render"]>) => void;
}) {
  const kind = viewKindOf(view);
  const collection = view.collection ?? { mode: "database" as const };
  const render = view.render ?? { layout: "graph-2d" as const, measure: { of: "count" as const } };

  if (kind === "collection") {
    return (
      <div className="mb-1 flex items-center gap-1" data-testid="views-layer-collection-controls">
        {(["database", "grid", "list"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={collection.mode === mode}
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              collection.mode === mode
                ? "bg-[var(--ink)] text-[var(--surface)]"
                : "bg-[var(--segmented-bg)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
            onClick={() => onCollection({ ...collection, mode })}
          >
            {mode === "database" ? "Table" : mode === "grid" ? "Grid" : "List"}
          </button>
        ))}
      </div>
    );
  }

  const chart = render.layout !== "graph-2d";
  return (
    <div
      className="mb-1 flex flex-wrap items-center gap-1"
      data-testid="views-layer-render-controls"
    >
      {(["graph-2d", "bar", "line"] as const).map((layout) => (
        <button
          key={layout}
          type="button"
          aria-pressed={render.layout === layout}
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            render.layout === layout
              ? "bg-[var(--ink)] text-[var(--surface)]"
              : "bg-[var(--segmented-bg)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
          }`}
          onClick={() => onRender({ ...render, layout })}
        >
          {layout === "graph-2d" ? "Graph" : layout === "bar" ? "Bars" : "Line"}
        </button>
      ))}
      {chart ? (
        <>
          <span aria-hidden="true" className="mx-1 h-3 w-px bg-[var(--hairline)]" />
          {(["count", "sum", "average"] as const).map((of) => (
            <button
              key={of}
              type="button"
              aria-pressed={render.measure?.of === of}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                render.measure?.of === of
                  ? "bg-[var(--ink)] text-[var(--surface)]"
                  : "bg-[var(--segmented-bg)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
              onClick={() =>
                onRender({
                  ...render,
                  // A sum needs a field; without one the count is the only honest measure, so the
                  // measure keeps its field until a field is chosen.
                  measure:
                    of === "count"
                      ? { of: "count" }
                      : {
                          of,
                          fieldId:
                            (render.measure?.of === "count"
                              ? undefined
                              : render.measure?.fieldId) ?? "",
                        },
                })
              }
            >
              {of === "count" ? "Count" : of === "sum" ? "Sum" : "Average"}
            </button>
          ))}
          <span aria-hidden="true" className="mx-1 h-3 w-px bg-[var(--hairline)]" />
          {([undefined, "type", "tag", "section"] as const).map((groupBy) => (
            <button
              key={groupBy ?? "none"}
              type="button"
              aria-pressed={render.groupBy === groupBy}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                render.groupBy === groupBy
                  ? "bg-[var(--ink)] text-[var(--surface)]"
                  : "bg-[var(--segmented-bg)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
              onClick={() => onRender({ ...render, groupBy })}
            >
              {groupBy === undefined ? "One bar" : `by ${groupBy}`}
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}
