import {
  type Card,
  type FieldDefinition,
  groupViewResult,
  resolveContext,
  type SavedView,
  sectionForCard,
  type ViewGroup,
  type ViewQuery,
  viewKindOf,
  type WorkspaceDocument,
} from "@suite/graph";
import { useMemo } from "react";
import { BoardMiniature } from "../canvas/BoardMiniature";
import { useEntityPeek } from "../canvas/peek/useEntityPeek";
import { boardMiniature } from "../canvas/portalMiniature";
import { ViewChart } from "../cards/ViewChart";
import { ViewFigure } from "../cards/ViewFigure";

export interface ViewSurfaceProps {
  view: SavedView;
  workspace: WorkspaceDocument;
  boardId: string | null;
  /** Read mode draws data and nothing else: a cell is a value, not an input. */
  editing?: boolean | undefined;
  /** A group this reader narrowed to, or null for the whole result. */
  drilldown?: { readonly groupBy: string; readonly key: string } | null;
  /** Fields this reader has hidden. */
  hiddenFields?: readonly string[] | undefined;
  /** Narrow the surface to one group, or to nothing. */
  onDrill?: ((groupBy: string, key: string | null) => void) | undefined;
  /** Sort the view by one column, which is a change to the shared query. */
  onSort?:
    | ((by: "title" | "updated" | "created" | "section", dir: "asc" | "desc") => void)
    | undefined;
  /** Opens the inspector for a card, which is the door for a cell this table cannot edit. */
  onOpenCard?: ((cardId: string) => void) | undefined;
}

/** The field kinds a cell edits in place. Anything else opens its own editor. */
const EDITABLE = new Set(["text", "number", "checkbox", "select"]);

/** How a grouping is named in a chip and a group header. */
export function groupByLabel(by: ViewQuery["groupBy"]): string {
  if (by === undefined) return "No grouping";
  if (typeof by === "object") return "Field";
  return by === "section" ? "Section" : by === "type" ? "Type" : "Tag";
}

/** The grouping key a store drill-down compares against, so a stale one is detectable. */
export function drillKeyOf(by: ViewQuery["groupBy"]): string {
  if (by === undefined) return "none";
  return typeof by === "object" ? `field:${by.field}` : by;
}

/**
 * The layer's surface: what the view selects, drawn the way its kind says.
 *
 * A collection is a table, a grid, a list or a board; a render is a graph or a chart. Reading and editing
 * are two states of one surface rather than two components: in read mode a cell is text and a row opens the
 * card, and in edit mode the same cell is an input, because a reader who stepped in to *read* should not be
 * met with six inputs.
 */
export function ViewSurface({
  view,
  workspace,
  boardId,
  editing = false,
  drilldown = null,
  hiddenFields = [],
  onDrill,
  onSort,
  onOpenCard,
}: ViewSurfaceProps) {
  const kind = viewKindOf(view);
  const peek = useEntityPeek();

  const context = useMemo(
    () => resolveContext(workspace, view, { boardId }),
    [workspace, view, boardId],
  );

  const groups = useMemo<ViewGroup[]>(
    () =>
      groupViewResult(
        workspace,
        view.query,
        { cardIds: [...context.cardIds], hits: new Map() },
        boardId === null ? {} : { boardId },
      ),
    [workspace, view.query, context, boardId],
  );

  if (kind === "render") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {view.render?.layout === "graph-2d" ? (
          <div className="min-h-0 flex-1" data-testid="view-surface-graph">
            <ViewFigure view={view} workspace={workspace} />
          </div>
        ) : (
          <div className="min-h-0 flex-1" data-testid="view-surface-chart">
            <ViewChart
              view={view}
              workspace={workspace}
              context={{ boardId }}
              onSelectBucket={
                onDrill === undefined
                  ? undefined
                  : (key) => onDrill(drillKeyOf(view.query.groupBy), key)
              }
            />
          </div>
        )}
      </div>
    );
  }

  if (context.cardIds.length === 0) {
    return (
      <p className="views-empty" data-testid="view-surface-empty">
        <span className="views-empty-title">This view selects nothing yet.</span>
        <span>Loosen the context, or pick cards from the board.</span>
      </p>
    );
  }

  const shown = narrow(groups, drilldown, drillKeyOf(view.query.groupBy));
  const mode = view.collection?.mode ?? "database";
  const typeById = new Map(workspace.listTypes().map((type) => [type.id, type]));
  const fields = visibleFields(workspace, shown, hiddenFields);

  if (mode === "board") {
    return (
      <BoardSurface
        workspace={workspace}
        groups={shown}
        boardId={boardId}
        onOpenCard={onOpenCard}
        onDrill={
          onDrill === undefined ? undefined : (key) => onDrill(drillKeyOf(view.query.groupBy), key)
        }
      />
    );
  }

  if (mode === "grid") {
    return (
      <div data-testid="view-surface-grid">
        {shown.map((group) => (
          <section key={group.key ?? "none"}>
            <GroupHead
              group={group}
              grouping={view.query.groupBy}
              onDrill={
                onDrill === undefined
                  ? undefined
                  : () => onDrill(drillKeyOf(view.query.groupBy), group.key)
              }
            />
            <ul className="views-grid">
              {group.cardIds.map((cardId) => (
                <li key={cardId}>
                  <CardTile
                    cardId={cardId}
                    workspace={workspace}
                    typeName={typeNameOf(typeById, workspace.getCard(cardId))}
                    onOpen={onOpenCard}
                    onPeek={() => peek.hover({ kind: "card", id: cardId })}
                    onLeave={() => peek.leave()}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  if (mode === "list") {
    return (
      <div data-testid="view-surface-list">
        {shown.map((group) => (
          <section key={group.key ?? "none"}>
            <GroupHead
              group={group}
              grouping={view.query.groupBy}
              onDrill={
                onDrill === undefined
                  ? undefined
                  : () => onDrill(drillKeyOf(view.query.groupBy), group.key)
              }
            />
            <ul className="views-list">
              {group.cardIds.map((cardId) => (
                <li key={cardId}>
                  <button
                    type="button"
                    className="views-list-row"
                    onClick={() => onOpenCard?.(cardId)}
                    onMouseEnter={() => peek.hover({ kind: "card", id: cardId })}
                    onMouseLeave={() => peek.leave()}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {workspace.displayTitle(cardId) || "Untitled"}
                    </span>
                    <span className="views-tertiary">{sectionOf(workspace, cardId)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <table className="views-table" data-testid="view-surface-table">
      <thead>
        <tr>
          <th>
            <SortButton label="Card" by="title" query={view.query} onSort={onSort} />
          </th>
          <th>Type</th>
          {fields.map((field) => (
            <th key={field.id}>{field.name}</th>
          ))}
          <th>
            <SortButton label="Section" by="section" query={view.query} onSort={onSort} />
          </th>
        </tr>
      </thead>
      {shown.map((group) => [
        <tbody key={`head-${group.key ?? "none"}`}>
          <tr>
            <td colSpan={3 + fields.length} style={{ padding: 0, border: "none" }}>
              <GroupHead
                group={group}
                grouping={view.query.groupBy}
                onDrill={
                  onDrill === undefined
                    ? undefined
                    : () => onDrill(drillKeyOf(view.query.groupBy), group.key)
                }
              />
            </td>
          </tr>
        </tbody>,
        <tbody key={group.key ?? "none"} data-testid="view-surface-rows">
          {group.cardIds.map((cardId) => {
            const card = workspace.getCard(cardId);
            return (
              <tr key={cardId}>
                <td>
                  <button
                    type="button"
                    className="views-sort-button"
                    title="Open this card on its board"
                    onClick={() => onOpenCard?.(cardId)}
                    onMouseEnter={() => peek.hover({ kind: "card", id: cardId })}
                    onMouseLeave={() => peek.leave()}
                  >
                    <span className="max-w-[240px] truncate">
                      {workspace.displayTitle(cardId) || "Untitled"}
                    </span>
                  </button>
                </td>
                <td className="views-tertiary">
                  {card === undefined ? "card" : typeNameOf(typeById, card)}
                </td>
                {fields.map((field) => (
                  <td key={field.id}>
                    {card === undefined ? null : (
                      <Cell card={card} field={field} workspace={workspace} editing={editing} />
                    )}
                  </td>
                ))}
                <td className="views-tertiary">{sectionOf(workspace, cardId)}</td>
              </tr>
            );
          })}
        </tbody>,
      ])}
    </table>
  );
}

/** The groups a drill-down leaves visible, or all of them. */
function narrow(
  groups: readonly ViewGroup[],
  drilldown: { readonly groupBy: string; readonly key: string } | null,
  currentKey: string,
): ViewGroup[] {
  // A drill-down belongs to the grouping it was made in: change the grouping and the narrow surface is no
  // longer a subset of anything, so it lets go rather than showing an empty view.
  if (drilldown === null || drilldown.groupBy !== currentKey) return [...groups];
  return groups.filter((group) => (group.key ?? "") === drilldown.key);
}

/** Every field any of the visible rows carries, in first-seen order, minus the hidden ones. */
function visibleFields(
  workspace: WorkspaceDocument,
  groups: readonly ViewGroup[],
  hidden: readonly string[],
): FieldDefinition[] {
  const seen = new Map<string, FieldDefinition>();
  const types = new Map(workspace.listTypes().map((type) => [type.id, type]));
  for (const group of groups) {
    for (const cardId of group.cardIds) {
      const card = workspace.getCard(cardId);
      if (card === undefined) continue;
      for (const field of types.get(card.primaryTypeId)?.fields ?? []) {
        if (!seen.has(field.id)) seen.set(field.id, field);
      }
    }
  }
  return [...seen.values()].filter((field) => !hidden.includes(field.id)).slice(0, 8);
}

function GroupHead({
  group,
  grouping,
  onDrill,
}: {
  group: ViewGroup;
  grouping: ViewQuery["groupBy"];
  onDrill?: (() => void) | undefined;
}) {
  if (grouping === undefined && group.key === null) return null;
  const label = group.key === null ? "No group" : group.key;
  return (
    <div className="views-group-head" data-testid="view-surface-group">
      {onDrill === undefined ? (
        <span>{label}</span>
      ) : (
        <button
          type="button"
          className="views-sort-button"
          title="Narrow this surface to this group"
          onClick={onDrill}
        >
          {label}
        </button>
      )}
      <span className="views-group-count">{group.cardIds.length}</span>
    </div>
  );
}

function SortButton({
  label,
  by,
  query,
  onSort,
}: {
  label: string;
  by: "title" | "updated" | "created" | "section";
  query: ViewQuery;
  onSort?: ViewSurfaceProps["onSort"];
}) {
  if (onSort === undefined) return <span>{label}</span>;
  const current = query.sorts?.find((sort) => sort.by === by);
  const arrow = current === undefined ? "" : current.dir === "asc" ? " ↑" : " ↓";
  return (
    <button
      type="button"
      className="views-sort-button"
      data-testid={`view-sort-${by}`}
      title={`Sort by ${label.toLowerCase()}`}
      onClick={() => onSort(by, current?.dir === "asc" ? "desc" : "asc")}
    >
      {label}
      {arrow}
    </button>
  );
}

/** A grid tile: the title, its type, and a peek on hover so a tile is not a blind link. */
function CardTile({
  cardId,
  workspace,
  typeName,
  onOpen,
  onPeek,
  onLeave,
}: {
  cardId: string;
  workspace: WorkspaceDocument;
  typeName: string;
  onOpen?: ((cardId: string) => void) | undefined;
  onPeek: () => void;
  onLeave: () => void;
}) {
  return (
    <button
      type="button"
      className="views-grid-tile"
      onClick={() => onOpen?.(cardId)}
      onMouseEnter={onPeek}
      onMouseLeave={onLeave}
    >
      <span className="truncate text-[12px]">{workspace.displayTitle(cardId) || "Untitled"}</span>
      <span className="views-tertiary">{typeName}</span>
    </button>
  );
}

/**
 * A view drawn as a place.
 *
 * The cards the view selects, on the board they actually sit on, at the position they actually hold: a
 * miniature rather than a second canvas, because a view that could be dragged inside would be an editor for
 * a layout the board already owns. Cards the view selects that are only in the inbox have no position to
 * draw, so they are named underneath instead of invented.
 */
function BoardSurface({
  workspace,
  groups,
  boardId,
  onOpenCard,
  onDrill,
}: {
  workspace: WorkspaceDocument;
  groups: readonly ViewGroup[];
  boardId: string | null;
  onOpenCard?: ((cardId: string) => void) | undefined;
  onDrill?: ((key: string) => void) | undefined;
}) {
  const selected = new Set(groups.flatMap((group) => group.cardIds));
  const boards = boardId === null ? workspace.listBoards() : [workspace.getBoard(boardId)];
  const drawn = boards.filter((board) => board !== undefined);
  const unplaced = [...selected].filter(
    (cardId) => !workspace.listPlacements().some((entry) => entry.cardId === cardId),
  );

  return (
    <div data-testid="view-surface-board" className="flex flex-wrap gap-3">
      {drawn.map((board) => {
        const sections = workspace.listSections(board.id);
        const placements = workspace
          .listBoardPlacements(board.id)
          .filter((placement) => selected.has(placement.cardId));
        return (
          <figure key={board.id} className="m-0 w-[220px]">
            <BoardMiniature
              model={boardMiniature(sections, placements)}
              label={`${board.name}, ${String(placements.length)} of this view`}
              className="h-[132px] w-full rounded border border-[var(--hairline)]"
            />
            <figcaption className="views-tertiary mt-1 flex items-center gap-1">
              <span className="truncate">{board.name}</span>
              <span className="views-rail-count">{placements.length}</span>
            </figcaption>
          </figure>
        );
      })}
      {unplaced.length === 0 ? null : (
        <div className="flex w-[220px] flex-col gap-1" data-testid="view-surface-board-inbox">
          <span className="views-drawer-title">In the inbox</span>
          <ul className="views-list">
            {unplaced.map((cardId) => (
              <li key={cardId}>
                <button
                  type="button"
                  className="views-list-row"
                  onClick={() => onOpenCard?.(cardId)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {workspace.displayTitle(cardId) || "Untitled"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {groups.some((group) => group.key !== null) && onDrill !== undefined ? (
        <div className="flex flex-col gap-1">
          <span className="views-drawer-title">Groups</span>
          {groups.map((group) => (
            <button
              key={group.key ?? "none"}
              type="button"
              className="views-chip"
              onClick={() => onDrill(group.key ?? "")}
            >
              {group.key ?? "No group"}
              <span className="views-chip-count">{group.cardIds.length}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  editing: boolean;
}

/**
 * One value.
 *
 * In read mode it is text and nothing else. In edit mode a keystroke goes to local state and the write
 * happens on Enter or blur, so typing in a table does not turn into one document write per character and
 * one undo step each.
 */
function Cell({ card, field, workspace, editing }: CellProps) {
  const value = card.properties[field.id];
  const text = value === undefined || value === null ? "" : String(value);

  if (!EDITABLE.has(field.kind)) {
    return (
      <span className="views-tertiary" title={field.name}>
        {text.length === 0 ? "—" : text}
      </span>
    );
  }

  if (!editing) {
    return (
      <span className="views-cell-plain" data-testid={`view-cell-${field.id}`}>
        {field.kind === "checkbox" ? (value === true ? "✓" : "—") : text.length === 0 ? "—" : text}
      </span>
    );
  }

  const commit = (next: string) => {
    if (next === text) return;
    workspace.setProperty(card.id, field.id, field.kind === "number" ? Number(next) : next);
  };

  if (field.kind === "checkbox") {
    return (
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={value === true}
          aria-label={field.name}
          onChange={(event) => workspace.setProperty(card.id, field.id, event.target.checked)}
        />
      </label>
    );
  }

  return <CellInput field={field} text={text} onCommit={commit} />;
}

function CellInput({
  field,
  text,
  onCommit,
}: {
  field: FieldDefinition;
  text: string;
  onCommit: (next: string) => void;
}) {
  return (
    <input
      className="views-cell-input"
      type={field.kind === "number" ? "number" : "text"}
      defaultValue={text}
      aria-label={field.name}
      title={field.name}
      onBlur={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(event.currentTarget.value);
          event.currentTarget.blur();
        }
        if (event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
}

/** The type of a card, for a surface that needs a name rather than an id. */
export function typeNameOf(
  types: ReadonlyMap<string, { name: string }>,
  card: Card | undefined,
): string {
  if (card === undefined) return "card";
  return types.get(card.primaryTypeId)?.name ?? "card";
}
