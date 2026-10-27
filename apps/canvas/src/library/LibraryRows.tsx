import type { SearchHit, Tag } from "@suite/graph";
import { highlightRanges } from "@suite/graph";
import type {
  KeyboardEvent as ReactKeyboardEvent,
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

const ROW_OPEN = "[data-row-open]";
const ROW_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * Arrows walk the rows; Enter is the row's own button.
 *
 * The rows carried `onPointerDown` alone, so a reader with no pointer could not
 * reach a row at all until a query put the search box's cursor on one. Every row
 * now holds an open button — that is the tab stop — and this moves between those
 * buttons the way a list does.
 */
function rowsKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
  if (!ROW_KEYS.has(event.key)) return;
  const list = event.currentTarget.closest(".library-list");
  if (list === null) return;
  const rows = [...list.querySelectorAll<HTMLElement>(ROW_OPEN)];
  if (rows.length === 0) return;

  event.preventDefault();
  const here = rows.indexOf(document.activeElement as HTMLElement);
  const at =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : event.key === "ArrowDown"
          ? (here + 1) % rows.length
          : (here <= 0 ? rows.length : here) - 1;
  rows[at]?.focus();
}

/**
 * The row's own keyboard path: a button around the text column.
 *
 * A pointer press belongs to the row, which lifts it for a drag or opens it when
 * it never moved, so this ignores pointer clicks (`detail` is 1 or more) and
 * takes only the keyboard's own activation (a synthesized click reports 0).
 */
function openOnKeyboard(event: ReactMouseEvent<HTMLButtonElement>, open: () => void): void {
  if (event.detail !== 0) return;
  open();
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
  /** The keyboard path into a card row. */
  onOpenCard: (cardId: string) => void;
  /** The keyboard path into a board row. */
  onOpenBoard: (boardId: string) => void;
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
    onOpenCard,
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
        onKeyDown={rowsKeyDown}
      >
        <div className="min-w-0 flex-1">
          {/* The title is the button, so the row's accessible name is the card's
              name and not its metadata. The rest of the row reads beside it. */}
          <button
            type="button"
            data-row-open={item.id}
            className="library-row__open block max-w-full truncate text-left text-[12px]"
            onClick={(event) => openOnKeyboard(event, () => onOpenCard(item.id))}
          >
            <span data-testid={`library-title-${item.id}`}>
              <Highlighted text={item.title} terms={searching ? terms : []} />
            </span>
          </button>
          {hit?.field === "body" ? (
            <span
              className="block truncate text-[10px] text-[var(--ink-muted)]"
              data-testid={`library-snippet-${item.id}`}
            >
              <Highlighted text={hit.snippet} terms={terms} />
            </span>
          ) : null}
          {item.tagIds.length > 0 ? (
            <span className="block truncate text-[10px] text-[var(--ink-muted)]">
              {item.tagIds
                .map((id) => tags.find((tag) => tag.id === id))
                .filter((tag): tag is Tag => tag !== undefined)
                .map((tag) => `#${tag.name}`)
                .join(" ")}
            </span>
          ) : null}
          {boardScope ? (
            <span
              className="block truncate text-[10px] text-[var(--ink-muted)]"
              data-testid="library-row-meta"
            >
              {sectionLabel(item)}
              {" \u00b7 "}
              {activeBoardName ?? "This board"}
            </span>
          ) : item.boards.length > 0 ? (
            <span className="block truncate text-[10px] text-[var(--ink-muted)]">
              {item.boards.map((board) => board.name).join(" \u00b7 ")}
            </span>
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
  onOpen,
}: {
  board: LibraryBoard;
  searching: boolean;
  terms: readonly string[];
  /** The keyboard path: the row's own open button. */
  onOpen: (boardId: string) => void;
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
        onKeyDown={rowsKeyDown}
      >
        <div className="min-w-0 flex-1">
          <button
            type="button"
            data-row-open={board.id}
            className="library-row__open block max-w-full truncate text-left text-[12px]"
            onClick={(event) => openOnKeyboard(event, () => onOpen(board.id))}
          >
            <span data-testid={`library-title-${board.id}`}>
              <Highlighted text={board.title} terms={searching ? terms : []} />
            </span>
          </button>
          <span className="block truncate text-[10px] text-[var(--ink-muted)]">
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
            {/* A board no portal names and the workspace does not open by default:
                the list is the only way in, which is worth saying while a guide is
                still being built. */}
            {board.unopened === true ? (
              <span
                data-testid={`library-board-unopened-${board.id}`}
                title="No portal opens this board, and it is not the board the workspace opens"
              >
                {" \u00b7 Nothing opens this"}
              </span>
            ) : null}
          </span>
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
        onOpen={context.onOpenBoard}
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
