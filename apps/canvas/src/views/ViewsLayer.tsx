import type { SavedView, ViewQuery } from "@suite/graph";
import { groupViewResult, resolveContext, viewKindOf } from "@suite/graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ViewFigure } from "../cards/ViewFigure";
import { VIEW_CARD_FIELD_ID } from "../cards/viewCard";
import { useSavedViews } from "../chrome/ViewsBar";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { IconGlyph } from "../icons/IconGlyph";
import { useEscapeLayer } from "../shell/escapeLayers";
import { PROJECTION_KEY, useProjectionStore } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { type LayerMode, useViewsStore } from "../store/viewsStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { Chip, Segmented } from "./chip";
import { draftToView } from "./draft";
import { SurfaceControls } from "./SurfaceControls";
import { ViewSurface } from "./ViewSurface";
import { ViewsContextDrawer } from "./ViewsContextDrawer";
import "../styles/views.css";

const KIND_OPTIONS = [
  { value: "collection", label: "Collection", title: "Rows of cards and their fields" },
  { value: "render", label: "Render", title: "A graph or a chart of the same cards" },
] as const;

interface OpenedSnapshot {
  readonly id: string;
  readonly name: string;
  readonly query: ViewQuery;
  readonly kind: "collection" | "render";
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
 * Two states, not one: **read** opens to the data and nothing else, and **edit** is the same surface with its
 * controls. Picking is the third: the layer steps out of the window and the board becomes the surface.
 */
export function ViewsLayer() {
  const workspace = useCanvasStore((state) => state.workspace);
  const open = useViewsStore((state) => state.open);
  const picking = useViewsStore((state) => state.picking);
  const editingId = useViewsStore((state) => state.editingId);
  const draft = useViewsStore((state) => state.draft);
  const contextOpen = useViewsStore((state) => state.contextOpen);
  const mode = useViewsStore((state) => state.mode);
  const drilldown = useViewsStore((state) => state.drilldown);
  const hiddenFields = useViewsStore((state) => state.hiddenFields);
  const deleted = useViewsStore((state) => state.deleted);
  const pendingCardId = useViewsStore((state) => state.pendingCardId);
  const openLayer = useViewsStore((state) => state.openLayer);
  const openNew = useViewsStore((state) => state.openNew);
  const close = useViewsStore((state) => state.close);
  const toggleContext = useViewsStore((state) => state.toggleContext);
  const setMode = useViewsStore((state) => state.setMode);
  const setDraft = useViewsStore((state) => state.setDraft);
  const created = useViewsStore((state) => state.created);
  const startPicking = useViewsStore((state) => state.startPicking);
  const drillInto = useViewsStore((state) => state.drillInto);
  const clearDrilldown = useViewsStore((state) => state.clearDrilldown);
  const noteDeleted = useViewsStore((state) => state.noteDeleted);
  const clearDeleted = useViewsStore((state) => state.clearDeleted);

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
  const editing = mode === "edit";

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
            kind: viewKindOf(record) === "render" ? "render" : "collection",
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

  // While picking, the board is the surface and the projection float carries the bar.
  if (picking) return null;

  if (workspace === null || view === undefined) {
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
        <EmptyLayer
          canManage={canManageSchema}
          onNew={() => openNew(views.length)}
          onStart={startFor(openNew, views.length)}
          onClose={close}
        />
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
  const projected = saved !== undefined && projectedId === saved.id;

  const discardMine = () => {
    const base = opened.current;
    if (base === null || workspace === null) return;
    workspace.renameView(base.id, base.name);
    workspace.patchViewQuery(base.id, base.query);
    workspace.setViewKind(base.id, base.kind, {
      ...(base.collection === undefined ? {} : { collection: base.collection }),
      ...(base.render === undefined ? {} : { render: base.render }),
    });
    workspace.clearViewPins(base.id);
    for (const cardId of base.pins) workspace.addViewPin(base.id, cardId);
  };

  const createDraft = (): string | null => {
    if (draft === null || workspace === null || !canManageSchema) return null;
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
    return record.id;
  };

  const cancelDraft = () => {
    if (pendingCardId !== null && workspace !== null) workspace.trashCard(pendingCardId);
    close();
  };

  const projectIt = () => {
    if (draft !== null) {
      // Projecting something that does not exist yet would leave a float naming a draft, so a draft is
      // created first: one press either way, and the record is what everyone else can open.
      createDraft();
      return;
    }
    if (saved === undefined) return;
    projection(saved.id);
    close();
  };

  /**
   * Picking is a projection being built, so it starts by projecting.
   *
   * The layer leaves the window, the board becomes the surface, and the float says what is being built. A
   * draft has no record to project yet, so it is created first: the same press either way, and what the
   * reader is looking at is what everyone else can open.
   */
  const startPick = () => {
    const base = pins;
    const target = saved?.id ?? createDraft();
    if (target === null) return;
    // Close first: leaving the layer clears its transient state, which picking then sets.
    close();
    startPicking(base);
    projection(target);
  };

  const remove = (id: string, name: string) => {
    if (workspace === null) return;
    workspace.deleteView(id);
    noteDeleted({ id, name });
  };

  const duplicate = (id: string) => {
    if (workspace === null) return;
    const copy = workspace.duplicateView(id);
    if (copy !== undefined) openLayer(copy.id);
  };

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Views"
      data-testid="views-layer"
      data-handbook-region="views-layer"
      data-mode={mode}
      className="views-layer fixed inset-0 z-[60] flex flex-col bg-[var(--surface)]"
    >
      <header className="views-header">
        <button
          type="button"
          className="views-icon-button"
          aria-label="Back to the board"
          data-testid="views-layer-back"
          title="Back to the board"
          onClick={close}
        >
          <IconGlyph icon="lucide:arrow-left" size={15} />
        </button>
        <input
          className="views-title-input"
          aria-label="View name"
          data-testid="views-layer-name"
          value={nameDraft ?? view.name}
          readOnly={!editing}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={(event) => rename(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setNameDraft(null);
          }}
        />
        <span className="views-rail-count" data-testid="views-layer-count">
          {pins.length} pinned
        </span>

        {editing ? (
          <Segmented
            label="Kind"
            testIdPrefix="views-layer-kind"
            value={viewKindOf(view) === "render" ? "render" : "collection"}
            options={KIND_OPTIONS}
            onChange={setKind}
          />
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {editing ? (
            <Chip
              action
              pressed={contextOpen}
              testId="views-layer-context"
              onClick={() => toggleContext()}
            >
              <IconGlyph icon="lucide:sliders-horizontal" size={12} />
              Context
            </Chip>
          ) : null}
          <Chip
            action
            testId="views-layer-pick"
            title="Add cards to this view by pressing them on the board"
            onClick={startPick}
            disabled={!editing}
          >
            <IconGlyph icon="lucide:crosshair" size={12} />
            Pick
          </Chip>
          <Chip
            action
            testId="views-layer-project"
            title="Cast this view over your board"
            onClick={projectIt}
          >
            <IconGlyph icon={projected ? "lucide:telescope" : "lucide:scan"} size={12} />
            {projected ? "Stop projecting" : "Project"}
          </Chip>
          {projected ? (
            <button
              type="button"
              data-testid="views-layer-unproject"
              className="views-button views-button--quiet"
              onClick={stopProjection}
            >
              Stop
            </button>
          ) : null}
          <ModeSwitch mode={mode} onMode={setMode} />
          <button
            type="button"
            aria-label="Close the views layer"
            data-testid="views-layer-close"
            className="views-icon-button"
            onClick={close}
          >
            <IconGlyph icon="lucide:x" size={15} />
          </button>
        </div>
      </header>

      <div className="views-body">
        <aside className="views-rail" aria-label="Saved views">
          <div className="views-rail-tools">
            <Chip
              action
              testId="views-layer-new"
              onClick={() => openNew(views.length)}
              disabled={!canManageSchema}
            >
              <IconGlyph icon="lucide:plus" size={12} />
              New view
            </Chip>
            <input
              className="views-input"
              aria-label="Filter views"
              placeholder="Filter…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <ul
            className="views-rail-scroll"
            data-testid="views-layer-rail"
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              const rows = [
                ...(event.currentTarget.querySelectorAll<HTMLButtonElement>(".views-rail-item") ??
                  []),
              ];
              const index = rows.indexOf(event.target as HTMLButtonElement);
              if (index === -1) return;
              event.preventDefault();
              rows[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
            }}
          >
            <Rail
              views={visible}
              activeId={editingId}
              workspace={workspace}
              onOpen={openLayer}
              onDuplicate={duplicate}
              onDelete={(id) => {
                const entry = visible.find((candidate) => candidate.id === id);
                remove(id, entry?.name ?? "this view");
              }}
            />
            {visible.length === 0 ? (
              <li className="views-rail-sub px-2 py-1">No views match.</li>
            ) : null}
          </ul>
        </aside>

        <main className="views-stage">
          <div className="views-stage-head">
            {editing ? (
              <SurfaceControls
                view={view}
                workspace={workspace}
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
                onQuery={writeQuery}
              />
            ) : (
              <ContextSentence view={view} workspace={workspace} boardId={boardId} />
            )}
            {drilldown === null ? null : (
              <Chip
                action
                testId="views-drilldown-clear"
                title="Show the whole view again"
                onClick={clearDrilldown}
              >
                Only {drilldown.key === "" ? "no group" : drilldown.key}
                <IconGlyph icon="lucide:x" size={11} />
              </Chip>
            )}
            {saved !== undefined && projected ? (
              <span className="views-chip" title="This view is cast over your board">
                Projected
              </span>
            ) : null}
          </div>

          <div className="views-scroll">
            <ViewSurface
              view={view}
              workspace={workspace}
              boardId={boardId}
              editing={editing}
              drilldown={drilldown}
              hiddenFields={hiddenFields}
              onDrill={(groupBy, key) => {
                if (key === null || key === "") clearDrilldown();
                else drillInto(groupBy, key);
              }}
              onSort={editing ? (by, dir) => writeQuery({ sorts: [{ by, dir }] }) : undefined}
              onOpenCard={(cardId) => {
                close();
                if (boardId !== null) focusCard(cardId, boardId);
              }}
            />
          </div>

          {contextOpen && editing ? (
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

      <footer className="views-footer">
        <span>
          {snapshot.boards.length} {snapshot.boards.length === 1 ? "board" : "boards"} ·{" "}
          {snapshot.cards.length} cards
        </span>
        {deleted === null ? null : (
          <Chip
            action
            testId="views-layer-restore"
            onClick={() => {
              if (workspace !== null) workspace.undo();
              clearDeleted();
            }}
          >
            <IconGlyph icon="lucide:undo-2" size={12} />
            {deleted.name} deleted · Undo
          </Chip>
        )}
        <span className="ml-auto flex items-center gap-1">
          {draft === null ? (
            <>
              {editing ? (
                <>
                  <button
                    type="button"
                    data-testid="views-layer-discard"
                    className="views-button views-button--quiet"
                    onClick={discardMine}
                  >
                    Discard my edits
                  </button>
                  <DeleteView
                    key={view.id}
                    view={view}
                    onDelete={() => remove(view.id, view.name)}
                  />
                </>
              ) : null}
              <button
                type="button"
                data-testid="views-layer-done"
                className="views-button views-button--primary"
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
                className="views-button views-button--quiet"
                onClick={cancelDraft}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="views-layer-create"
                className="views-button views-button--primary"
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

/** Read and Edit: one switch, because they are two states of one surface. */
function ModeSwitch({ mode, onMode }: { mode: LayerMode; onMode: (mode: LayerMode) => void }) {
  return (
    <Segmented
      label="Reading or editing"
      testIdPrefix="views-layer-mode"
      value={mode}
      options={[
        { value: "read", label: "Read", title: "Read the view; cells are values, not inputs" },
        { value: "edit", label: "Edit", title: "Change the view's context and presentation" },
      ]}
      onChange={onMode}
    />
  );
}

function DeleteView({ view, onDelete }: { view: SavedView; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  // Two presses rather than a dialog: a view is one record, and undo already covers the mistake. The
  // component is keyed on the view id by its caller, so a different view starts unarmed.
  return (
    <button
      type="button"
      data-testid="views-layer-delete"
      className="views-button views-button--quiet"
      onClick={() => (armed ? onDelete() : setArmed(true))}
      title={armed ? "Press again to delete, or undo afterwards" : `Delete ${view.name}`}
    >
      <IconGlyph icon="lucide:trash" size={12} />
      {armed ? "Really delete" : "Delete"}
    </button>
  );
}

/**
 * The rail, as a list rather than a column of buttons.
 *
 * A saved view is a record, so the rail carries the record's verbs: open, duplicate, delete, and a
 * reordering gesture is a document write through `moveView`. Keyboard first: ↑/↓ move, Enter opens, D
 * duplicates, Backspace deletes, so the rail is usable without a pointer.
 */
function Rail({
  views,
  activeId,
  workspace,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  views: readonly SavedView[];
  activeId: string | null;
  workspace: NonNullable<ReturnType<typeof useCanvasStore.getState>["workspace"]>;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const grouped = views.length > 8;
  const bucket = (kind: string) => views.filter((view) => viewKindOf(view) === kind);

  const row = (entry: SavedView) => (
    <li
      key={entry.id}
      className="views-rail-row"
      data-active={entry.id === activeId ? "true" : undefined}
    >
      <button
        type="button"
        data-testid={`views-layer-rail-${entry.id}`}
        aria-current={entry.id === activeId ? "true" : undefined}
        className="views-rail-item"
        onClick={() => onOpen(entry.id)}
        onKeyDown={(event) => {
          if (event.key === "d" || event.key === "D") {
            event.preventDefault();
            onDuplicate(entry.id);
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            onDelete(entry.id);
          }
        }}
      >
        <span className="views-rail-thumb">
          <ViewFigure view={entry} workspace={workspace} />
        </span>
        <span className="views-rail-meta">
          <IconGlyph
            icon={viewKindOf(entry) === "render" ? "lucide:network" : "lucide:table"}
            size={11}
          />
          <span className="views-rail-name">{entry.name}</span>
          <span className="views-rail-count">{countOf(workspace, entry)}</span>
        </span>
      </button>
      <span className="views-rail-actions">
        <button
          type="button"
          className="views-icon-button"
          aria-label={`Duplicate ${entry.name}`}
          data-testid={`views-layer-rail-duplicate-${entry.id}`}
          onClick={() => onDuplicate(entry.id)}
        >
          <IconGlyph icon="lucide:copy" size={12} />
        </button>
        <button
          type="button"
          className="views-icon-button"
          aria-label={`Delete ${entry.name}`}
          data-testid={`views-layer-rail-delete-${entry.id}`}
          onClick={() => onDelete(entry.id)}
        >
          <IconGlyph icon="lucide:trash" size={12} />
        </button>
      </span>
    </li>
  );

  if (!grouped) return <>{views.map((entry) => row(entry))}</>;

  return (
    <>
      {(["collection", "render"] as const).map((kind) => (
        <li key={kind}>
          <p className="views-rail-group">{kind === "render" ? "Renders" : "Collections"}</p>
          <ul className="views-rail-nested">{bucket(kind).map((entry) => row(entry))}</ul>
        </li>
      ))}
    </>
  );
}

/** How many cards a saved view's context selects, computed from the same rule the surface uses. */
function countOf(
  workspace: NonNullable<ReturnType<typeof useCanvasStore.getState>["workspace"]>,
  view: SavedView,
): number {
  return resolveContext(workspace, view, {}).cardIds.length;
}

/** The context as a sentence: what this view is, said in one line rather than six controls. */
function ContextSentence({
  view,
  workspace,
  boardId,
}: {
  view: SavedView;
  workspace: NonNullable<ReturnType<typeof useCanvasStore.getState>["workspace"]>;
  boardId: string | null;
}) {
  const context = useMemo(
    () => resolveContext(workspace, view, { boardId }),
    [workspace, view, boardId],
  );
  const groups = useMemo(
    () =>
      groupViewResult(
        workspace,
        view.query,
        { cardIds: [...context.cardIds], hits: new Map() },
        boardId === null ? {} : { boardId },
      ).length,
    [workspace, view.query, context.cardIds, boardId],
  );

  const parts: string[] = [];
  if (view.query.text) parts.push(`“${view.query.text}”`);
  const facets =
    view.query.typeIds.length + view.query.tagIds.length + view.query.sectionIds.length;
  if (facets > 0) parts.push(`${String(facets)} filters`);
  if (view.query.scope === "board") parts.push("on this board");
  if (view.context !== undefined && view.context.cardIds.length > 0) {
    parts.push(`${String(view.context.cardIds.length)} picked by hand`);
  }
  if (groups > 1) parts.push(`${String(groups)} groups`);

  return (
    <span
      className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--ink-muted)]"
      data-testid="views-context-sentence"
    >
      <IconGlyph icon="lucide:filter" size={11} />
      {parts.length === 0 ? "Everything in the workspace" : parts.join(" · ")}
      <span className="views-rail-count">{context.cardIds.length} cards</span>
    </span>
  );
}

/** The first run: no views at all, which is the one state that has to explain what a view is. */
function EmptyLayer({
  canManage,
  onNew,
  onStart,
  onClose,
}: {
  canManage: boolean;
  onNew: () => void;
  onStart: (query: ViewQuery, name: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="views-empty" data-testid="views-layer-empty">
      <span className="views-empty-title">A view is a question you can ask again</span>
      <span>
        It selects cards — by words, by type, by tag, or by the ones you pick by hand — and
        remembers how to present them. Nothing is copied: editing a card in a view edits the card.
      </span>
      <span className="views-empty-actions">
        <Chip action testId="views-empty-new" onClick={onNew} disabled={!canManage}>
          <IconGlyph icon="lucide:plus" size={12} />
          Start from scratch
        </Chip>
        <Chip
          action
          testId="views-empty-board"
          disabled={!canManage}
          onClick={() => onStart({ ...emptyQuery(), scope: "board" }, "Cards on this board")}
        >
          Everything on this board
        </Chip>
        <Chip
          action
          testId="views-empty-week"
          disabled={!canManage}
          onClick={() =>
            onStart(
              { ...emptyQuery(), order: "updated", sorts: [{ by: "updated", dir: "desc" }] },
              "Recently changed",
            )
          }
        >
          Recently changed
        </Chip>
      </span>
      <button type="button" className="views-button views-button--quiet" onClick={onClose}>
        Back to the board
      </button>
    </div>
  );
}

function emptyQuery(): ViewQuery {
  return {
    typeIds: [],
    tagIds: [],
    sectionIds: [],
    scope: "all",
    groupBySection: false,
    order: "title",
  };
}

/**
 * A starter opens a *draft*, not a record: the point of a one-press start is to show the reader a view
 * before the workspace has one, and a draft is exactly that.
 */
function startFor(openNew: (count: number) => void, count: number) {
  return (query: ViewQuery, name: string) => {
    openNew(count);
    useViewsStore.getState().setDraft({ query, name });
  };
}
