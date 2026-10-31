import {
  resolveContext,
  type SavedView,
  type ViewCollectionMode,
  type ViewKind,
  type ViewRenderLayout,
  type WorkspaceDocument,
} from "@suite/graph";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CardPicker } from "../cards/CardPicker";
import { VIEW_CARD_FIELD_ID } from "../cards/viewCard";
import { useSavedViews } from "../chrome/ViewsBar";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { draftIsDirty, draftToView } from "../views/draft";
import { advancedCount, ViewQueryAdvanced } from "./ViewQueryAdvanced";

const KIND_LABELS: Record<ViewKind, { title: string; blurb: string; glyph: string }> = {
  lens: {
    title: "Lens",
    blurb: "Highlight these cards on the board and fade everything else.",
    glyph: "\u25c7",
  },
  collection: {
    title: "Collection",
    blurb: "The same cards as a table, a grid or a list.",
    glyph: "\u25a6",
  },
  render: {
    title: "Render",
    blurb: "The same cards as a graph, or as a chart over a count.",
    glyph: "\u25c8",
  },
};

const MODES: { id: ViewCollectionMode; label: string }[] = [
  { id: "database", label: "Database" },
  { id: "grid", label: "Grid" },
  { id: "list", label: "List" },
];

const LAYOUTS: { id: ViewRenderLayout; label: string }[] = [
  { id: "graph-2d", label: "Graph" },
  { id: "bar", label: "Bar chart" },
  { id: "line", label: "Line chart" },
];

const chip = (active: boolean) =>
  `rounded-full px-1.5 py-0.5 text-[11px] ${
    active
      ? "bg-[var(--ink)] text-[var(--surface)]"
      : "bg-[var(--segmented-bg)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
  }`;

const sectionTitle = "text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]";
const inputClass =
  "w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]";

export interface ViewsEditorProps {
  /** Defaults to the live document; tests inject their own. */
  workspace?: WorkspaceDocument | null;
}

/**
 * The views editor, as a sheet on the right.
 *
 * It is a *sheet* rather than a centred dialog because the draft is applied while you edit: a lens
 * dims and outlines the board as the context changes, and a collection or render takes the board area
 * beside it. A modal with a scrim would be a preview nobody can see.
 *
 * It holds no document state until Save. The draft lives in `viewsStore`, the board reads it through
 * `draftToView`, and Save is the one call that writes.
 */
export function ViewsEditor({ workspace: workspaceProp = null }: ViewsEditorProps) {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = workspaceProp ?? storeWorkspace;
  const views = useSavedViews(workspace);
  const snapshot = useWorkspaceSnapshot();

  const draft = useViewsStore((state) => state.draft);
  const editorOpen = useViewsStore((state) => state.editorOpen);
  const preview = useViewsStore((state) => state.preview);
  const previous = useViewsStore((state) => state.previous);
  const pendingCardId = useViewsStore((state) => state.pendingCardId);
  const openNew = useViewsStore((state) => state.openNew);
  const openView = useViewsStore((state) => state.openView);
  const patchDraft = useViewsStore((state) => state.patch);
  const closeEditor = useViewsStore((state) => state.closeEditor);
  const setPreview = useViewsStore((state) => state.setPreview);
  const discard = useViewsStore((state) => state.discard);
  const saved = useViewsStore((state) => state.saved);

  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const selectedIds = useUiStore((state) => state.selectedNodeIds);
  const applyView = useUiStore((state) => state.applyView);
  const exitView = useUiStore((state) => state.exitView);
  const present = useViewsStore((state) => state.present);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const nameField = useRef<HTMLInputElement | null>(null);

  useEscapeLayer(closeEditor, editorOpen);

  useEffect(() => {
    if (editorOpen) nameField.current?.focus();
  }, [editorOpen]);

  const savedSource = useMemo(
    () =>
      draft?.sourceId === null || draft === null
        ? undefined
        : views.find((v) => v.id === draft.sourceId),
    [draft, views],
  );

  // `resolveContext` reads the document itself, so the draft and the board are the inputs. The
  // snapshot is what tells this read that the document moved (a card trashed, a pin deleted).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the full snapshot is the invalidation signal.
  const context = useMemo(() => {
    if (workspace === null || draft === null) return null;
    return resolveContext(workspace, draftToView(draft), { boardId: activeBoardId });
  }, [workspace, draft, activeBoardId, snapshot]);

  if (!editorOpen || draft === null) return null;

  const dirty = draftIsDirty(draft, savedSource);
  const title = savedSource === undefined ? "New view" : `Editing “${savedSource.name}”`;

  const patch = (next: Parameters<typeof patchDraft>[0]) => patchDraft(next);

  const save = () => {
    if (workspace === null || !canManageSchema) return;
    const name = draft.name.trim();
    if (name.length === 0) return;
    const payload = {
      name,
      query: draft.query,
      kind: draft.kind,
      context: { cardIds: [...draft.cardIds] },
      lens: draft.lens,
      collection: draft.collection,
      render: draft.render,
    };
    if (draft.sourceId === null) {
      const created = workspace.createView({ ...payload, name });
      // A view opened from the canvas placed a card first, so the card can present it the moment it
      // exists. Until this line the card says "No view chosen", which is honest and fixable.
      if (pendingCardId !== null)
        workspace.setProperty(pendingCardId, VIEW_CARD_FIELD_ID, created.id);
      applyView(created.id, created.query);
      saved(created.id);
      // A lens is drawn on the board; a collection or a render needs a surface, so saving one shows
      // it. That is the "apply and close" the editor promised, per kind.
      present(draft.kind === "lens" ? null : created.id);
      return;
    }
    workspace.updateView(draft.sourceId, payload);
    applyView(draft.sourceId, draft.query);
    saved(draft.sourceId);
    present(draft.kind === "lens" ? null : draft.sourceId);
  };

  const saveAsCopy = () => {
    if (workspace === null || !canManageSchema) return;
    const copy = workspace.createView({
      name: `${draft.name.trim() || "View"} copy`,
      query: draft.query,
      kind: draft.kind,
      context: { cardIds: [...draft.cardIds] },
      lens: draft.lens,
      collection: draft.collection,
      render: draft.render,
    });
    applyView(copy.id, copy.query);
    saved(copy.id);
  };

  const cancel = () => {
    // A view that was never saved leaves nothing on the board: the card existed so the reader could
    // see where the view would go, not as a permanent empty frame.
    if (pendingCardId !== null && workspace !== null) workspace.trashCard(pendingCardId);
    discard();
    if (previous !== null && workspace !== null) {
      const restore = workspace.getView(previous);
      if (restore) applyView(restore.id, restore.query);
      else exitView();
      return;
    }
    exitView();
  };

  const remove = (view: SavedView) => {
    if (workspace === null) return;
    workspace.deleteView(view.id);
    if (draft.sourceId === view.id) cancel();
    setConfirmDelete(null);
  };

  const cardOptions = snapshot.cards
    .filter((card) => card.deletedAt == null)
    .map((card) => ({
      id: card.id,
      title: workspace?.displayTitle(card.id) ?? card.id,
    }));

  const pins = draft.cardIds
    .map((id) => ({
      id,
      title: cardOptions.find((option) => option.id === id)?.title ?? "Removed",
    }))
    .filter((entry) => entry.title !== "Removed");

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Views"
      data-testid="views-editor"
      data-handbook-region="views-editor"
      className="fixed top-0 right-0 z-[55] flex h-full w-[min(560px,100vw)] border-l border-[var(--hairline)] bg-[var(--surface)] shadow-2xl"
    >
      <div className="flex w-40 shrink-0 flex-col border-r border-[var(--hairline)]">
        <div className="border-b border-[var(--hairline)] p-2">
          <button
            type="button"
            data-testid="views-editor-new"
            className="w-full rounded-md border border-[var(--hairline)] px-2 py-1 text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => openNew(views.length)}
          >
            New view
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1" data-testid="views-editor-rail">
          {views.length === 0 ? (
            <li className="px-2 py-1 text-[11px] text-[var(--ink-muted)]">No saved views yet.</li>
          ) : null}
          {views.map((view) => {
            const kind = view.kind ?? "lens";
            const selected = draft.sourceId === view.id;
            return (
              <li key={view.id} className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid={`views-editor-rail-${view.id}`}
                  data-active={selected ? "true" : undefined}
                  aria-current={selected ? "true" : undefined}
                  className={`min-w-0 flex-1 rounded px-1.5 py-1 text-left text-[12px] ${
                    selected
                      ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
                      : "text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                  onClick={() => openView(view)}
                >
                  <span aria-hidden="true" className="mr-1 opacity-70">
                    {KIND_LABELS[kind].glyph}
                  </span>
                  <span className="truncate">{view.name}</span>
                </button>
                {confirmDelete === view.id ? (
                  <button
                    type="button"
                    data-testid={`views-editor-delete-confirm-${view.id}`}
                    className="rounded px-1 text-[10px] text-red-600"
                    onClick={() => remove(view)}
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${view.name}`}
                    data-testid={`views-editor-delete-${view.id}`}
                    className="rounded px-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    onClick={() => setConfirmDelete(view.id)}
                  >
                    {"\u00d7"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{title}</span>
          <button
            type="button"
            data-testid="views-editor-preview"
            aria-pressed={preview}
            title="Apply the draft to the board while you edit"
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              preview
                ? "bg-[var(--ink)] text-[var(--surface)]"
                : "bg-[var(--segmented-bg)] text-[var(--ink-muted)]"
            }`}
            onClick={() => setPreview(!preview)}
          >
            Live preview
          </button>
          <button
            type="button"
            aria-label="Close the views editor"
            data-testid="views-editor-close"
            className="rounded px-1.5 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
            onClick={closeEditor}
          >
            {"\u00d7"}
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          <section className="flex flex-col gap-1.5" aria-labelledby="views-step-context">
            <h2 id="views-step-context" className={sectionTitle}>
              1 · Context
            </h2>
            <input
              className={inputClass}
              data-testid="views-editor-text"
              aria-label="Words a card must contain"
              placeholder="Words in a title or a body…"
              value={draft.query.text ?? ""}
              onChange={(event) =>
                patch({
                  query: {
                    ...draft.query,
                    ...(event.target.value.length === 0
                      ? { text: undefined }
                      : { text: event.target.value }),
                  },
                })
              }
            />
            <div className="flex items-center gap-1">
              {(["both", "title", "body"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  aria-pressed={(draft.query.textScope ?? "both") === scope}
                  className={chip((draft.query.textScope ?? "both") === scope)}
                  onClick={() =>
                    patch({
                      query: { ...draft.query, textScope: scope === "both" ? undefined : scope },
                    })
                  }
                >
                  {scope === "both" ? "Everywhere" : scope === "title" ? "Titles" : "Bodies"}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1">
                {(["all", "board"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    aria-pressed={draft.query.scope === scope}
                    className={chip(draft.query.scope === scope)}
                    onClick={() => patch({ query: { ...draft.query, scope } })}
                  >
                    {scope === "all" ? "All cards" : "This board"}
                  </button>
                ))}
              </span>
            </div>

            <fieldset className="flex flex-wrap items-center gap-1">
              <legend className="sr-only">Card types</legend>
              {snapshot.types.map((type) => {
                const active = draft.query.typeIds.includes(type.id);
                return (
                  <button
                    key={type.id}
                    type="button"
                    aria-pressed={active}
                    className={chip(active)}
                    onClick={() =>
                      patch({
                        query: {
                          ...draft.query,
                          typeIds: active
                            ? draft.query.typeIds.filter((id) => id !== type.id)
                            : [...draft.query.typeIds, type.id],
                        },
                      })
                    }
                  >
                    {type.name}
                  </button>
                );
              })}
            </fieldset>

            <fieldset className="flex flex-wrap items-center gap-1">
              <legend className="sr-only">Tags</legend>
              {snapshot.tags.map((tag) => {
                const active = draft.query.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={active}
                    className={chip(active)}
                    onClick={() =>
                      patch({
                        query: {
                          ...draft.query,
                          tagIds: active
                            ? draft.query.tagIds.filter((id) => id !== tag.id)
                            : [...draft.query.tagIds, tag.id],
                        },
                      })
                    }
                  >
                    #{tag.name}
                  </button>
                );
              })}
            </fieldset>

            {snapshot.sections.length === 0 ? null : (
              <fieldset className="flex flex-wrap items-center gap-1">
                <legend className="sr-only">Sections</legend>
                {snapshot.sections.map((section) => {
                  const active = draft.query.sectionIds.includes(section.id);
                  return (
                    <button
                      key={section.id}
                      type="button"
                      aria-pressed={active}
                      className={chip(active)}
                      onClick={() =>
                        patch({
                          query: {
                            ...draft.query,
                            sectionIds: active
                              ? draft.query.sectionIds.filter((id) => id !== section.id)
                              : [...draft.query.sectionIds, section.id],
                          },
                        })
                      }
                    >
                      {section.title.trim() || "Untitled section"}
                    </button>
                  );
                })}
              </fieldset>
            )}

            <div className="flex flex-wrap items-center gap-1 border-t border-[var(--hairline)] pt-1.5">
              <span className="text-[11px] text-[var(--ink-muted)]">Pinned</span>
              {pins.map((pin) => (
                <span
                  key={pin.id}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--segmented-bg)] px-1.5 text-[10px]"
                >
                  {pin.title}
                  <button
                    type="button"
                    aria-label={`Unpin ${pin.title}`}
                    className="opacity-60 hover:opacity-100"
                    onClick={() => patch({ cardIds: draft.cardIds.filter((id) => id !== pin.id) })}
                  >
                    {"\u00d7"}
                  </button>
                </span>
              ))}
              {pins.length === 0 ? (
                <span className="text-[10px] text-[var(--ink-muted)]">None</span>
              ) : null}
              <button
                type="button"
                data-testid="views-editor-add-card"
                className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                onClick={() => setPickerOpen((open) => !open)}
              >
                Add cards…
              </button>
              {selectedIds.length > 0 ? (
                <button
                  type="button"
                  data-testid="views-editor-use-selection"
                  className="rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                  onClick={() =>
                    patch({
                      cardIds: [...new Set([...draft.cardIds, ...selectedIds])],
                    })
                  }
                >
                  Use the selection ({selectedIds.length})
                </button>
              ) : null}
            </div>
            {pickerOpen ? (
              <CardPicker
                cards={cardOptions}
                label="Add a card to this view"
                onChange={(cardId) => patch({ cardIds: [...new Set([...draft.cardIds, cardId])] })}
                onClear={() => setPickerOpen(false)}
              />
            ) : null}

            <p className="text-[11px] text-[var(--ink-muted)]" data-testid="views-editor-readout">
              {context === null
                ? "No workspace"
                : `${String(context.cardIds.length)} ${context.cardIds.length === 1 ? "card" : "cards"} · ${String(draft.cardIds.length)} pinned · ${String(context.byBoard.size)} ${context.byBoard.size === 1 ? "board" : "boards"}`}
              {context !== null && context.inInbox.length > 0
                ? ` · ${String(context.inInbox.length)} in the inbox`
                : ""}
              {context !== null && context.missingPins.length > 0
                ? ` · ${String(context.missingPins.length)} pinned ${context.missingPins.length === 1 ? "card is" : "cards are"} gone`
                : ""}
            </p>

            <button
              type="button"
              data-testid="views-editor-advanced"
              aria-expanded={advancedOpen}
              className="w-fit rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              Advanced{advancedCount(draft) > 0 ? ` · ${String(advancedCount(draft))}` : ""}{" "}
              {advancedOpen ? "\u25be" : "\u25b8"}
            </button>
            {advancedOpen ? (
              <ViewQueryAdvanced
                draft={draft}
                types={snapshot.types}
                tags={snapshot.tags}
                sections={snapshot.sections}
                onChange={(next) => patch({ query: { ...draft.query, ...next } })}
              />
            ) : null}
          </section>

          <section className="mt-3 flex flex-col gap-1.5" aria-labelledby="views-step-kind">
            <h2 id="views-step-kind" className={sectionTitle}>
              2 · Kind
            </h2>
            <div className="flex flex-col gap-1">
              {(Object.keys(KIND_LABELS) as ViewKind[]).map((kind) => {
                const active = draft.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    data-testid={`views-editor-kind-${kind}`}
                    aria-pressed={active}
                    className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left ${
                      active
                        ? "border-[var(--ink-muted)] bg-[var(--segmented-bg)]"
                        : "border-[var(--hairline)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                    }`}
                    onClick={() => patch({ kind })}
                  >
                    <span aria-hidden="true" className="text-[12px] opacity-70">
                      {KIND_LABELS[kind].glyph}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px]">{KIND_LABELS[kind].title}</span>
                      <span className="block text-[11px] text-[var(--ink-muted)]">
                        {KIND_LABELS[kind].blurb}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-3 flex flex-col gap-1.5" aria-labelledby="views-step-presentation">
            <h2 id="views-step-presentation" className={sectionTitle}>
              3 · Presentation
            </h2>
            {draft.kind === "lens" ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="views-editor-fade"
                    aria-pressed={draft.lens.fade !== false}
                    className={chip(draft.lens.fade !== false)}
                    onClick={() =>
                      patch({ lens: { ...draft.lens, fade: draft.lens.fade === false } })
                    }
                  >
                    Fade everything else
                  </button>
                  <button
                    type="button"
                    data-testid="views-editor-outline"
                    aria-pressed={draft.lens.outline !== false}
                    className={chip(draft.lens.outline !== false)}
                    onClick={() =>
                      patch({ lens: { ...draft.lens, outline: draft.lens.outline === false } })
                    }
                  >
                    Outline the selection
                  </button>
                </div>
                <p className="text-[11px] text-[var(--ink-muted)]">
                  Cards in the inbox are counted but cannot be shown on a board.
                </p>
              </div>
            ) : null}
            {draft.kind === "collection" ? (
              <div className="flex items-center gap-1">
                {MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={draft.collection.mode === mode.id}
                    className={chip(draft.collection.mode === mode.id)}
                    onClick={() => patch({ collection: { ...draft.collection, mode: mode.id } })}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            ) : null}
            {draft.kind === "render" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  {LAYOUTS.map((layout) => (
                    <button
                      key={layout.id}
                      type="button"
                      aria-pressed={draft.render.layout === layout.id}
                      className={chip(draft.render.layout === layout.id)}
                      onClick={() => patch({ render: { ...draft.render, layout: layout.id } })}
                    >
                      {layout.label}
                    </button>
                  ))}
                </div>
                {draft.render.layout === "graph-2d" ? null : (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-[var(--ink-muted)]">Measure</span>
                    <button
                      type="button"
                      aria-pressed={(draft.render.measure ?? { of: "count" }).of === "count"}
                      className={chip((draft.render.measure ?? { of: "count" }).of === "count")}
                      onClick={() =>
                        patch({ render: { ...draft.render, measure: { of: "count" } } })
                      }
                    >
                      Count
                    </button>
                    <span className="text-[10px] text-[var(--ink-muted)]">
                      Sum and average land with the field picker.
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="flex shrink-0 flex-col gap-1 border-t border-[var(--hairline)] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <input
              ref={nameField}
              className={inputClass}
              data-testid="views-editor-name"
              aria-label="View name"
              value={draft.name}
              placeholder="View name"
              onChange={(event) => patch({ name: event.target.value })}
            />
            {dirty ? (
              <span
                className="shrink-0 rounded-full bg-[var(--segmented-bg)] px-1.5 text-[10px] text-[var(--ink-muted)]"
                data-testid="views-editor-dirty"
              >
                Unsaved
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="views-editor-cancel"
              className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={cancel}
            >
              Cancel
            </button>
            {draft.sourceId === null ? null : (
              <button
                type="button"
                data-testid="views-editor-copy"
                className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={saveAsCopy}
                disabled={!canManageSchema}
              >
                Save as copy
              </button>
            )}
            <button
              type="button"
              data-testid="views-editor-save"
              className="ml-auto rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)] disabled:opacity-40"
              onClick={save}
              disabled={!canManageSchema || draft.name.trim().length === 0}
              title={
                canManageSchema ? undefined : "You do not have permission to change this workspace"
              }
            >
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
