import type { SavedView, ViewQuery, WorkspaceDocument } from "@suite/graph";
import { resolveContext } from "@suite/graph";
import { useMemo, useState } from "react";
import { CardPicker } from "../cards/CardPicker";
import { advancedCount, ViewQueryAdvanced } from "../panels/ViewQueryAdvanced";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

export interface ViewsContextDrawerProps {
  /** The live view: a saved record being edited, or a new draft. */
  view: SavedView;
  workspace: WorkspaceDocument;
  boardId: string | null;
  /** Writes the query keys a control changed, and nothing else. */
  onQuery: (patch: Partial<ViewQuery>) => void;
  onPin: (cardId: string) => void;
  onUnpin: (cardId: string) => void;
  /** Leave the layer and pick cards on the board. */
  onPick: () => void;
  onClose: () => void;
}

const chip = (active: boolean) =>
  `rounded-full px-1.5 py-0.5 text-[11px] ${
    active
      ? "bg-[var(--ink)] text-[var(--surface)]"
      : "bg-[var(--segmented-bg)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
  }`;

const inputClass =
  "w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]";

const sectionTitle = "text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]";

/**
 * The context, as a drawer over the layer's rail.
 *
 * The layer's default state shows data, not form fields: a reader who stepped in to *read* should not be
 * met with six inputs. The controls are one press away, they write the live record as they change, and the
 * read-out underneath is the sentence that says what the context currently is.
 */
export function ViewsContextDrawer({
  view,
  workspace,
  boardId,
  onQuery,
  onPin,
  onUnpin,
  onPick,
  onClose,
}: ViewsContextDrawerProps) {
  const snapshot = useWorkspaceSnapshot();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot is the invalidation signal.
  const context = useMemo(
    () => resolveContext(workspace, view, { boardId }),
    [workspace, view, boardId, snapshot],
  );

  const pins = view.context?.cardIds ?? [];
  const cardOptions = snapshot.cards
    .filter((card) => card.deletedAt == null)
    .map((card) => ({ id: card.id, title: workspace.displayTitle(card.id) || card.id }));

  return (
    <div
      data-testid="views-context"
      className="absolute inset-y-0 left-0 z-10 flex w-[320px] flex-col gap-2 overflow-y-auto border-r border-[var(--hairline)] bg-[var(--surface)] p-3 shadow-xl"
    >
      <div className="flex items-center gap-2">
        <h2 className={sectionTitle}>Context</h2>
        <button
          type="button"
          aria-label="Close the context"
          data-testid="views-context-close"
          className="ml-auto rounded px-1.5 text-[12px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
          onClick={onClose}
        >
          {"\u00d7"}
        </button>
      </div>

      <input
        className={inputClass}
        data-testid="views-context-text"
        aria-label="Words a card must contain"
        placeholder="Words in a title or a body…"
        value={view.query.text ?? ""}
        onChange={(event) =>
          onQuery({ text: event.target.value.length === 0 ? undefined : event.target.value })
        }
      />

      <div className="flex flex-wrap items-center gap-1">
        {(["both", "title", "body"] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            aria-pressed={(view.query.textScope ?? "both") === scope}
            className={chip((view.query.textScope ?? "both") === scope)}
            onClick={() => onQuery({ textScope: scope === "both" ? undefined : scope })}
          >
            {scope === "both" ? "Everywhere" : scope === "title" ? "Titles" : "Bodies"}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          {(["all", "board"] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              aria-pressed={view.query.scope === scope}
              className={chip(view.query.scope === scope)}
              onClick={() => onQuery({ scope })}
            >
              {scope === "all" ? "All cards" : "This board"}
            </button>
          ))}
        </span>
      </div>

      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="sr-only">Card types</legend>
        {snapshot.types.map((type) => {
          const active = view.query.typeIds.includes(type.id);
          return (
            <button
              key={type.id}
              type="button"
              aria-pressed={active}
              className={chip(active)}
              onClick={() =>
                onQuery({
                  typeIds: active
                    ? view.query.typeIds.filter((id) => id !== type.id)
                    : [...view.query.typeIds, type.id],
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
          const active = view.query.tagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={active}
              className={chip(active)}
              onClick={() =>
                onQuery({
                  tagIds: active
                    ? view.query.tagIds.filter((id) => id !== tag.id)
                    : [...view.query.tagIds, tag.id],
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
            const active = view.query.sectionIds.includes(section.id);
            return (
              <button
                key={section.id}
                type="button"
                aria-pressed={active}
                className={chip(active)}
                onClick={() =>
                  onQuery({
                    sectionIds: active
                      ? view.query.sectionIds.filter((id) => id !== section.id)
                      : [...view.query.sectionIds, section.id],
                  })
                }
              >
                {section.title.trim() || "Untitled section"}
              </button>
            );
          })}
        </fieldset>
      )}

      <div className="flex flex-col gap-1 border-t border-[var(--hairline)] pt-2">
        <div className="flex items-center gap-1">
          <span className={sectionTitle}>Pinned</span>
          <button
            type="button"
            data-testid="views-context-pick"
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
            onClick={onPick}
          >
            Pick cards on the board
          </button>
        </div>
        {pins.length === 0 ? (
          <p className="text-[11px] text-[var(--ink-muted)]">No pinned cards.</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {pins.map((cardId) => {
              const gone = cardOptions.every((option) => option.id !== cardId);
              return (
                <li key={cardId}>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] ${
                      gone ? "bg-red-500/10 text-red-600" : "bg-[var(--segmented-bg)]"
                    }`}
                  >
                    {gone ? "Removed" : workspace.displayTitle(cardId) || "Untitled"}
                    <button
                      type="button"
                      aria-label={`Unpin ${gone ? "removed card" : workspace.displayTitle(cardId)}`}
                      className="opacity-60 hover:opacity-100"
                      onClick={() => onUnpin(cardId)}
                    >
                      {"\u00d7"}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          data-testid="views-context-add-card"
          className="w-fit rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
          onClick={() => setPickerOpen((open) => !open)}
        >
          Add a card by name…
        </button>
        {pickerOpen ? (
          <CardPicker
            cards={cardOptions}
            label="Add a card to this view"
            onChange={(cardId) => onPin(cardId)}
            onClear={() => setPickerOpen(false)}
          />
        ) : null}
      </div>

      <p className="text-[11px] text-[var(--ink-muted)]" data-testid="views-context-readout">
        {context === null
          ? "No workspace"
          : `${String(context.cardIds.length)} ${context.cardIds.length === 1 ? "card" : "cards"} · ${String(pins.length)} pinned · ${String(context.byBoard.size)} ${context.byBoard.size === 1 ? "board" : "boards"}`}
        {context !== null && context.inInbox.length > 0
          ? ` · ${String(context.inInbox.length)} in the inbox`
          : ""}
        {context !== null && context.missingPins.length > 0
          ? ` · ${String(context.missingPins.length)} pinned ${context.missingPins.length === 1 ? "card is" : "cards are"} gone`
          : ""}
      </p>

      <button
        type="button"
        data-testid="views-context-advanced"
        aria-expanded={advancedOpen}
        className="w-fit rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        Advanced{advancedCount(view.query) > 0 ? ` · ${String(advancedCount(view.query))}` : ""}{" "}
        {advancedOpen ? "\u25be" : "\u25b8"}
      </button>
      {advancedOpen ? (
        <ViewQueryAdvanced
          query={view.query}
          types={snapshot.types}
          tags={snapshot.tags}
          sections={snapshot.sections}
          onChange={onQuery}
        />
      ) : null}
    </div>
  );
}
