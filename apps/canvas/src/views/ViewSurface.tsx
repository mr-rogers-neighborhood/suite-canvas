import {
  type Card,
  type CardType,
  type FieldDefinition,
  resolveContext,
  type SavedView,
  sectionForCard,
  viewKindOf,
  type WorkspaceDocument,
} from "@suite/graph";
import { useMemo, useState } from "react";
import { ViewChart } from "../cards/ViewChart";
import { ViewFigure } from "../cards/ViewFigure";

export interface ViewSurfaceProps {
  view: SavedView;
  workspace: WorkspaceDocument;
  boardId: string | null;
  /** Opens the inspector for a card, which is the door for a cell this table cannot edit. */
  onOpenCard?: ((cardId: string) => void) | undefined;
}

/** The field kinds a cell edits in place. Anything else opens its own editor. */
const EDITABLE = new Set(["text", "number", "checkbox", "select"]);

/**
 * The layer's main surface: what the view selects, drawn the way its kind says.
 *
 * A collection is a table, a grid or a list; a render is a graph or a chart. The table is editable where
 * the field is a kind that round-trips through `setProperty` (text, number, checkbox, select); anything
 * richer shows its value and leaves editing to the inspector, because a cell that invented a text protocol
 * for a relation would be a second, worse editor.
 */
export function ViewSurface({ view, workspace, boardId, onOpenCard }: ViewSurfaceProps) {
  const kind = viewKindOf(view);

  const context = useMemo(
    () => resolveContext(workspace, view, { boardId }),
    [workspace, view, boardId],
  );

  if (kind === "render") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {view.render?.layout === "graph-2d" ? (
          <div className="min-h-0 flex-1" data-testid="view-surface-graph">
            <ViewFigure view={view} workspace={workspace} />
          </div>
        ) : (
          <div className="min-h-0 flex-1" data-testid="view-surface-chart">
            <ViewChart view={view} workspace={workspace} context={{ boardId }} />
          </div>
        )}
      </div>
    );
  }

  if (context.cardIds.length === 0) {
    return (
      <p className="p-4 text-[12px] text-[var(--ink-muted)]" data-testid="view-surface-empty">
        This view selects nothing yet. Loosen the context, or pick cards from the board.
      </p>
    );
  }

  const mode = view.collection?.mode ?? "database";
  const typeById = new Map(workspace.listTypes().map((type) => [type.id, type]));

  if (mode === "grid") {
    return (
      <ul
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2"
        data-testid="view-surface-grid"
      >
        {context.cardIds.map((cardId) => {
          const card = workspace.getCard(cardId);
          const type = card === undefined ? undefined : typeById.get(card.primaryTypeId);
          return (
            <li key={cardId}>
              <button
                type="button"
                className="w-full rounded-lg border border-[var(--hairline)] p-2 text-left hover:border-[var(--ink-muted)]"
                onClick={() => onOpenCard?.(cardId)}
              >
                <span className="block truncate text-[12px]">
                  {workspace.displayTitle(cardId) || "Untitled"}
                </span>
                <span className="block text-[10px] text-[var(--ink-muted)]">
                  {type?.name ?? "card"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  if (mode === "list") {
    return (
      <ul className="flex flex-col" data-testid="view-surface-list">
        {context.cardIds.map((cardId) => (
          <li key={cardId}>
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b border-[var(--hairline)] px-1 py-1 text-left text-[12px] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              onClick={() => onOpenCard?.(cardId)}
            >
              <span className="min-w-0 flex-1 truncate">
                {workspace.displayTitle(cardId) || "Untitled"}
              </span>
              <span className="text-[10px] text-[var(--ink-muted)]">
                {sectionOf(workspace, cardId)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <table
      className="w-full border-collapse text-left text-[12px]"
      data-testid="view-surface-table"
    >
      <thead>
        <tr className="border-b border-[var(--hairline)] text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
          <th className="px-1 py-1 font-medium">Card</th>
          <th className="px-1 py-1 font-medium">Type</th>
          <th className="px-1 py-1 font-medium">Fields</th>
          <th className="px-1 py-1 font-medium">Section</th>
        </tr>
      </thead>
      <tbody>
        {context.cardIds.map((cardId) => {
          const card = workspace.getCard(cardId);
          const type = card === undefined ? undefined : typeById.get(card.primaryTypeId);
          return (
            <tr key={cardId} className="border-b border-[var(--hairline)] align-top">
              <td className="max-w-[240px] truncate px-1 py-1">
                {onOpenCard ? (
                  <button
                    type="button"
                    className="truncate text-left hover:underline"
                    onClick={() => onOpenCard(cardId)}
                  >
                    {workspace.displayTitle(cardId) || "Untitled"}
                  </button>
                ) : (
                  workspace.displayTitle(cardId) || "Untitled"
                )}
              </td>
              <td className="px-1 py-1 text-[var(--ink-muted)]">{type?.name ?? "card"}</td>
              <td className="px-1 py-1">
                {card === undefined ? null : (
                  <div className="flex flex-wrap gap-1">
                    {(type?.fields ?? []).slice(0, 4).map((field) => (
                      <Cell key={field.id} card={card} field={field} workspace={workspace} />
                    ))}
                  </div>
                )}
              </td>
              <td className="px-1 py-1 text-[var(--ink-muted)]">{sectionOf(workspace, cardId)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function sectionOf(workspace: WorkspaceDocument, cardId: string): string {
  const placement = workspace.listPlacements().find((entry) => entry.cardId === cardId);
  if (placement === undefined) return "Inbox";
  const section = sectionForCard(placement, workspace.listSections(placement.boardId));
  return section?.title.trim() || "—";
}

interface CellProps {
  card: Card;
  field: FieldDefinition;
  workspace: WorkspaceDocument;
}

/**
 * One value. Editing is deliberate: a keystroke goes to local state and the write happens on blur or
 * Enter, so typing in a table does not turn into one document write per character and one undo step each.
 */
function Cell({ card, field, workspace }: CellProps) {
  const value = card.properties[field.id];
  const [draft, setDraft] = useState<string>(
    value === undefined || value === null ? "" : String(value),
  );

  if (!EDITABLE.has(field.kind)) {
    return (
      <span className="rounded bg-[var(--segmented-bg)] px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)]">
        {field.name}: {value === undefined || value === null ? "—" : String(value)}
      </span>
    );
  }

  const commit = (next: string) => {
    if (next === (value === undefined || value === null ? "" : String(value))) return;
    workspace.setProperty(card.id, field.id, field.kind === "number" ? Number(next) : next);
  };

  if (field.kind === "checkbox") {
    return (
      <label className="flex items-center gap-1 text-[10px] text-[var(--ink-muted)]">
        <input
          type="checkbox"
          checked={value === true}
          aria-label={field.name}
          onChange={(event) => workspace.setProperty(card.id, field.id, event.target.checked)}
        />
        {field.name}
      </label>
    );
  }

  return (
    <label className="flex items-center gap-1 text-[10px] text-[var(--ink-muted)]">
      <span className="sr-only">{field.name}</span>
      <input
        className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-[var(--ink)] hover:border-[var(--hairline)] focus:border-[var(--ink-muted)] focus:outline-none"
        type={field.kind === "number" ? "number" : "text"}
        value={draft}
        title={field.name}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/** The type of a card, for a surface that needs a name rather than an id. */
export function typeNameOf(types: readonly CardType[], card: Card | undefined): string {
  if (card === undefined) return "card";
  return types.find((type) => type.id === card.primaryTypeId)?.name ?? "card";
}
