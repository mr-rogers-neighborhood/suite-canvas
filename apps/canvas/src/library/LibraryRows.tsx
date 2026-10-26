import type { SearchHit, Tag } from "@suite/graph";
import { highlightRanges } from "@suite/graph";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type { LibraryBoard, LibraryEntry, LibraryItem } from "./libraryTypes";

/**
 * The overflow button every row carries.
 *
 * A row offered up to six buttons in a drawer a few hundred pixels wide, which
 * pushed the entity's own title out of the row — the one thing the row exists to
 * show (ADR-0011 §6). The
 * actions move into the same context menu the canvas uses, opened by this button
 * or by right-clicking anywhere on the row.
 */
function RowMenuButton({
  id,
  label,
  onOpen,
}: {
  id: string;
  label: string;
  onOpen: (point: { x: number; y: number }) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Actions for ${label}`}
      aria-haspopup="menu"
      data-testid={`library-row-menu-${id}`}
      className="library-action library-row-menu"
      title="More actions"
      // The row's press starts a drag-to-place gesture; the menu button must not
      // arm it, or the menu closes as the row lifts.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect();
        onOpen({ x: box.right, y: box.bottom });
      }}
    >
      {"\u22ef"}
    </button>
  );
}

/** Highlighted runs of a result title or snippet, straight from the index terms. */
function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  const ranges = terms.length === 0 ? [] : highlightRanges(text, terms);
  if (ranges.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark
        key={`${range.start}-${range.end}`}
        data-testid="library-match"
        className="library-match rounded-sm bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-400/25"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** Everything a card row reads from the drawer; the drawer owns the gesture. */
export interface LibraryRowContext {
  tags: Tag[];
  searching: boolean;
  terms: readonly string[];
  hits: ReadonlyMap<string, SearchHit>;
  /** Keyboard cursor row, when a search is active. */
  activeId: string | undefined;
  selectedIds: readonly string[];
  activeRow: RefObject<HTMLLIElement | null>;
  /** The Cards tab scoped to a board shows the section instead of the boards. */
  boardScope: boolean;
  activeBoardName: string | null;
  sectionLabel: (item: LibraryItem) => string;
  onOpenMenu: (
    id: string,
    label: string,
    point: { x: number; y: number },
    event?: ReactMouseEvent,
  ) => void;
  /** A press starts a hold-to-place, or selects, in selection mode. */
  onPressRow: (item: LibraryItem, event: ReactPointerEvent) => void;
}

/** One card row: title, match snippet, tags and the board/section line. */
export function LibraryCardRow({
  item,
  context,
}: {
  item: LibraryItem;
  context: LibraryRowContext;
}) {
  const {
    tags,
    searching,
    terms,
    hits,
    activeId,
    selectedIds,
    activeRow,
    boardScope,
    activeBoardName,
    sectionLabel,
    onOpenMenu,
    onPressRow,
  } = context;
  const hit: SearchHit | undefined = searching ? hits.get(item.id) : undefined;
  const current = activeId === item.id;
  return (
    <li
      key={item.id}
      className="library-entry"
      data-row-id={item.id}
      data-active={current ? "true" : undefined}
      data-selected={selectedIds.includes(item.id) ? "true" : undefined}
      aria-current={current ? "true" : undefined}
      ref={current ? activeRow : undefined}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the row is a canvas-like list item whose right-click opens the same menu its ⋯ button does; the button is the keyboard path. */}
      <div
        data-testid={`library-item-${item.id}`}
        className="library-row"
        onContextMenu={(event) =>
          onOpenMenu(item.id, item.title, { x: event.clientX, y: event.clientY }, event)
        }
        onPointerDown={(event) => onPressRow(item, event)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px]" data-testid={`library-title-${item.id}`}>
            <Highlighted text={item.title} terms={searching ? terms : []} />
          </p>
          {hit?.field === "body" ? (
            <p
              className="truncate text-[10px] text-[var(--ink-muted)]"
              data-testid={`library-snippet-${item.id}`}
            >
              <Highlighted text={hit.snippet} terms={terms} />
            </p>
          ) : null}
          {item.tagIds.length > 0 ? (
            <p className="truncate text-[10px] text-[var(--ink-muted)]">
              {item.tagIds
                .map((id) => tags.find((tag) => tag.id === id))
                .filter((tag): tag is Tag => tag !== undefined)
                .map((tag) => `#${tag.name}`)
                .join(" ")}
            </p>
          ) : null}
          {boardScope ? (
            <p
              className="truncate text-[10px] text-[var(--ink-muted)]"
              data-testid="library-row-meta"
            >
              {sectionLabel(item)}
              {" \u00b7 "}
              {activeBoardName ?? "This board"}
            </p>
          ) : item.boards.length > 0 ? (
            <p className="truncate text-[10px] text-[var(--ink-muted)]">
              {item.boards.map((board) => board.name).join(" \u00b7 ")}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <RowMenuButton
            id={item.id}
            label={item.title}
            onOpen={(point) => onOpenMenu(item.id, item.title, point)}
          />
        </div>
      </div>
    </li>
  );
}

/** One board row: name, open state, card count and the blueprint marker. */
export function LibraryBoardRow({
  board,
  searching,
  terms,
  onOpenMenu,
}: {
  board: LibraryBoard;
  searching: boolean;
  terms: readonly string[];
  onOpenMenu: (
    id: string,
    label: string,
    point: { x: number; y: number },
    event?: ReactMouseEvent,
  ) => void;
}) {
  return (
    <li key={board.id} className="library-entry" data-row-id={board.id}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same as a card row — the ⋯ button is the keyboard path to this menu. */}
      <div
        data-testid={`library-item-${board.id}`}
        data-board-open={board.open ? "true" : "false"}
        className="library-row"
        onContextMenu={(event) =>
          onOpenMenu(board.id, board.title, { x: event.clientX, y: event.clientY }, event)
        }
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px]" data-testid={`library-title-${board.id}`}>
            <Highlighted text={board.title} terms={searching ? terms : []} />
          </p>
          <p className="truncate text-[10px] text-[var(--ink-muted)]">
            <span data-testid={`library-board-state-${board.id}`}>
              {board.open ? "Open" : "Closed"}
            </span>
            {" \u00b7 "}
            {board.cardCount} {board.cardCount === 1 ? "card" : "cards"}
            {/* The state moved out of the row's buttons into its menu, so the row
              says it in words: a blueprint is a fact about the board, not only
              something you can toggle. The word is the interface's; the record
              still calls the flag `template` (ADR-0059). */}
            {board.template === true ? (
              <span data-testid={`library-board-template-${board.id}`}>{" \u00b7 blueprint"}</span>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <RowMenuButton
            id={board.id}
            label={board.title}
            onOpen={(point) => onOpenMenu(board.id, board.title, point)}
          />
        </div>
      </div>
    </li>
  );
}

/** The scrolling list of rows, grouped by section or flat. */
export function LibraryRowList({
  entries,
  grouped,
  context,
}: {
  entries: LibraryEntry[];
  grouped: { id: string; title: string; depth: number; items: LibraryItem[] }[] | null;
  context: LibraryRowContext;
}) {
  const renderEntry = (entry: LibraryEntry) => {
    const key = entry.kind === "board" ? `board:${entry.board.id}` : `card:${entry.card.id}`;
    return entry.kind === "board" ? (
      <LibraryBoardRow
        key={key}
        board={entry.board}
        searching={context.searching}
        terms={context.terms}
        onOpenMenu={context.onOpenMenu}
      />
    ) : (
      <LibraryCardRow key={key} item={entry.card} context={context} />
    );
  };

  if (!grouped) return <ul className="space-y-0.5">{entries.map(renderEntry)}</ul>;
  return (
    <div className="space-y-2">
      {grouped.map((group) => (
        <section key={group.id} data-testid={`library-group-${group.id}`}>
          <h3
            className="library-group-heading"
            style={{ paddingLeft: 4 + group.depth * 10 }}
            data-depth={group.depth}
          >
            <span className="min-w-0 truncate">{group.title}</span>
            <span className="tabular-nums text-[var(--ink-muted)]">{group.items.length}</span>
          </h3>
          <ul className="space-y-0.5">
            {group.items.map((item) => renderEntry({ kind: "card", card: item }))}
          </ul>
        </section>
      ))}
    </div>
  );
}
