import type { CardType, PropertyValue, SearchHit, Tag, WorkspaceDocument } from "@suite/graph";
import { highlightRanges, typePluralName } from "@suite/graph";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { LIBRARY_SEARCH_FOCUS_EVENT, useLibrarySearch } from "../hooks/useLibrarySearch";
import { useCanvasStore } from "../store/useCanvasStore";
import type { LibraryScope, LibraryTab } from "../store/useUiStore";
import { useUiStore } from "../store/useUiStore";
import { Dialog } from "./Dialog";
import {
  facetCounts,
  filterItems,
  groupBySection as groupSections,
  type SectionOrderEntry,
  UNSORTED_SECTION,
} from "./libraryFilters";
import { type BoardStarter, TemplateGallery } from "./TemplateGallery";
import { useSavedViews } from "./ViewsBar";

export interface LibraryItem {
  id: string;
  title: string;
  boards: Array<{ id: string; name: string }>;
  typeIds: string[];
  tagIds: string[];
  /** The card's section on the scoped board plus its ancestors, innermost first. */
  sectionIds: string[];
  properties: Record<string, PropertyValue>;
}

/**
 * A board in the library's Boards section. A board has a name and placements —
 * no types, tags or fields (ADR-0040), so it is its own row shape rather than a
 * `LibraryItem` with invented values.
 */
export interface LibraryBoard {
  id: string;
  title: string;
  /** Whether the board currently has a tab; a closed board is still listed. */
  open: boolean;
  /** Cards placed on this board right now. */
  cardCount: number;
  /** Offered in the Boards tab's Templates group; using one copies the board. */
  template?: boolean;
}

/** What a drawer row can be. Boards are global: they never leave this list. */
export type LibraryEntry =
  | { kind: "card"; card: LibraryItem }
  | { kind: "board"; board: LibraryBoard };

export interface LibraryDrawerProps {
  open: boolean;
  tab: LibraryTab;
  /** `Partial` so a caller (or a story) that predates a tab still type-checks. */
  counts: Partial<Record<LibraryTab, number>>;
  inbox: LibraryItem[];
  cards: LibraryItem[];
  trash: LibraryItem[];
  /** Every board in the workspace, open or closed. */
  boards?: LibraryBoard[];
  /** Switches to the board, giving it a tab. */
  onOpenBoard?: (boardId: string) => void;
  /** Creates a portal card to the board on the active board; the row stays put. */
  onPlaceBoard?: (boardId: string) => void;
  /** Removes this board's placements only; a card on another board stays there. */
  onUnplaceBoardCards?: (boardId: string) => void;
  /** Asks once, here: unplace the cards or trash them with the board. */
  onDeleteBoard?: (boardId: string, cards: "keep" | "trash") => void;
  /** Pans to a card on the active board; false when it is not on this one. */
  onLocateCard?: (cardId: string) => boolean;
  /** Pans to this board's portal on the active board, else opens the board. */
  onLocateBoard?: (boardId: string) => boolean;
  /**
   * Copies a template into a new board and opens it. Absent when this session
   * may not create boards, which also hides the Templates group.
   */
  onUseBoardTemplate?: (templateId: string) => void;
  /** Generates a built-in starter as a new board and opens it. */
  onUseStarter?: (starterId: string) => void;
  /** Marks or unmarks a board as a template. Absent leaves the rows alone. */
  onSetBoardTemplate?: (boardId: string, template: boolean) => void;
  /** Built-in shapes offered under the workspace's own templates. */
  starters?: readonly BoardStarter[];
  onTab: (tab: LibraryTab) => void;
  onClose: () => void;
  onPlace: (cardId: string) => void;
  /**
   * Whether this session may write layout. A viewer still lifts a row and still
   * publishes the ghost — seeing the gesture is how they know something is
   * happening — but releasing over the canvas places nothing.
   */
  canPlace?: boolean;
  onCreateInInbox: () => void;
  onTrash: (cardId: string) => void;
  onRestore: (cardId: string) => void;
  onDeleteForever: (cardId: string) => void;
  onEmptyTrash: () => void;
  onGoToBoard: (boardId: string) => void;
  /** Pointer drop over the canvas, in client coordinates. */
  onDropAt: (cardId: string, point: { x: number; y: number }) => void;
  types: CardType[];
  tags: Tag[];
  typeFilter: string[];
  tagFilter: string[];
  onToggleType: (id: string) => void;
  onToggleTag: (id: string) => void;
  onClearFilters: () => void;
  /** Board that scopes the Cards tab, and the name the scope control shows. */
  activeBoardId: string | null;
  activeBoardName: string | null;
  scope: LibraryScope;
  onScope: (scope: LibraryScope) => void;
  sectionFilter: string[];
  onToggleSection: (id: string) => void;
  /** Sections of the active board in outline order. */
  sectionOrder: SectionOrderEntry[];
  groupBySection: boolean;
  onToggleGroup: () => void;
  /** Opens a card in the inspector; rows never expand in place. */
  onOpenCard: (cardId: string) => void;
  /** Trash, restore, purge and empty the trash; owner and workspace editor. */
  canManageTrash?: boolean;
  /** Search source; defaults to the live document in the canvas store. */
  workspace?: WorkspaceDocument | null;
  /** Seeds the query box. Stories and tests only. */
  initialQuery?: string;
}

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "cards", label: "Cards" },
  { id: "boards", label: "Boards" },
  { id: "trash", label: "Trash" },
];

const HOLD_THRESHOLD = 4;

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

export function LibraryDrawer({
  open,
  tab,
  counts,
  inbox,
  cards,
  trash,
  boards = [],
  onOpenBoard = () => {},
  onPlaceBoard = () => {},
  onUnplaceBoardCards = () => {},
  onDeleteBoard = () => {},
  onLocateCard = () => false,
  onLocateBoard = () => false,
  onUseBoardTemplate,
  onUseStarter = () => {},
  onSetBoardTemplate,
  starters = [],
  onTab,
  onClose,
  onPlace,
  canPlace = true,
  onCreateInInbox,
  onTrash,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
  onGoToBoard,
  onDropAt,
  types,
  tags,
  typeFilter,
  tagFilter,
  onToggleType,
  onToggleTag,
  onClearFilters,
  activeBoardId,
  activeBoardName,
  scope,
  onScope,
  sectionFilter,
  onToggleSection,
  sectionOrder,
  groupBySection,
  onToggleGroup,
  onOpenCard,
  canManageTrash = true,
  workspace: workspaceProp = null,
  initialQuery = "",
}: LibraryDrawerProps) {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = workspaceProp ?? storeWorkspace;
  const activeViewId = useUiStore((state) => state.activeViewId);
  const exitView = useUiStore((state) => state.exitView);
  const setLibraryQuery = useUiStore((state) => state.setLibraryQuery);
  const setLibraryDrag = useUiStore((state) => state.setLibraryDrag);
  const views = useSavedViews(workspace);
  const activeView = views.find((view) => view.id === activeViewId);
  const [hold, setHold] = useState<{ item: LibraryItem; x: number; y: number } | null>(null);
  const [activeResult, setActiveResult] = useState(0);
  /** A Locate that found nothing says so instead of moving the camera. */
  const [locateMiss, setLocateMiss] = useState<string | null>(null);
  /** The board whose delete is being asked about; the only place a board is deleted. */
  const [pendingDelete, setPendingDelete] = useState<LibraryBoard | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const activeRow = useRef<HTMLLIElement | null>(null);
  const focusPending = useRef(false);
  const holdRef = useRef<{
    cardId: string;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  const boardScope = tab === "cards" && scope === "board" && activeBoardId !== null;
  const items = tab === "inbox" ? inbox : tab === "cards" ? cards : tab === "trash" ? trash : [];
  const scopedItems = boardScope
    ? items.filter((item) => item.boards.some((board) => board.id === activeBoardId))
    : items;
  const activeSectionFilter = boardScope ? sectionFilter : [];
  const {
    query,
    setQuery,
    active: searching,
    terms,
    hits,
    ids: rankedIds,
  } = useLibrarySearch(workspace, scopedItems, initialQuery);

  // Boards are a name and a placement count, so they are matched by title only:
  // the card index has nothing to say about them.
  const boardQuery = query.trim().toLowerCase();
  const visibleBoards =
    tab !== "boards"
      ? []
      : boardQuery.length === 0
        ? boards
        : boards.filter((board) => board.title.toLowerCase().includes(boardQuery));

  // The Templates group answers the same query as the list: a search narrows
  // both halves instead of leaving a gallery of things the reader did not ask for.
  const matchesBoardQuery = (title: string) =>
    boardQuery.length === 0 || title.toLowerCase().includes(boardQuery);
  const visibleTemplates =
    tab === "boards"
      ? boards.filter((board) => board.template && matchesBoardQuery(board.title))
      : [];
  const visibleStarters =
    tab === "boards" ? starters.filter((entry) => matchesBoardQuery(entry.title)) : [];

  // The app bar offers "save current search"; it reads the live text through
  // the store rather than reaching into this component.
  const updateQuery = useCallback(
    (next: string) => {
      setQuery(next);
      setLibraryQuery(next);
    },
    [setQuery, setLibraryQuery],
  );

  // Opening a view fills the box once, from the stored query. Typing afterwards
  // belongs to the reader and is never written back to the view.
  const appliedView = useRef<string | null>(null);
  useEffect(() => {
    if (activeViewId === null) {
      if (appliedView.current === null) return;
      appliedView.current = null;
      updateQuery("");
      return;
    }
    if (appliedView.current === activeViewId) return;
    appliedView.current = activeViewId;
    updateQuery(workspace?.getView(activeViewId)?.query.text ?? "");
  }, [activeViewId, workspace, updateQuery]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The first Escape clears the query; only the next one closes the drawer.
      if (query.trim().length > 0) {
        event.preventDefault();
        event.stopPropagation();
        updateQuery("");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, query, updateQuery]);

  useEffect(() => {
    const focus = () => {
      const input = searchInput.current;
      if (!input) {
        // Still closed; the drawer focuses the box once it mounts.
        focusPending.current = true;
        return;
      }
      input.focus();
      input.select();
    };
    window.addEventListener(LIBRARY_SEARCH_FOCUS_EVENT, focus);
    return () => window.removeEventListener(LIBRARY_SEARCH_FOCUS_EVENT, focus);
  }, []);

  useEffect(() => {
    if (!open || !focusPending.current) return;
    focusPending.current = false;
    searchInput.current?.focus();
    searchInput.current?.select();
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query resets the keyboard cursor.
  useEffect(() => {
    setActiveResult(0);
  }, [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the cursor is the trigger; the row is a ref.
  useEffect(() => {
    activeRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeResult]);

  useEffect(() => {
    if (!open) {
      setHold(null);
      setPendingDelete(null);
      setLocateMiss(null);
    }
  }, [open]);

  // Pointer-based hold: the row lifts into a ghost that follows the cursor, and
  // dropping over the canvas places the card there.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = holdRef.current;
      if (!current) return;
      const far =
        Math.abs(event.clientX - current.startX) > HOLD_THRESHOLD ||
        Math.abs(event.clientY - current.startY) > HOLD_THRESHOLD;
      if (!far && !current.dragging) return;
      current.dragging = true;
      // The canvas owns the camera, so this is a screen point here and a flow
      // point by the time it reaches presence.
      setLibraryDrag({
        cardId: current.cardId,
        screen: { x: event.clientX, y: event.clientY },
      });
      setHold((previous) =>
        previous ? { ...previous, x: event.clientX, y: event.clientY } : null,
      );
    };

    const up = (event: PointerEvent) => {
      const current = holdRef.current;
      holdRef.current = null;
      setHold(null);
      setLibraryDrag(null);
      if (!current) return;
      // A press that never became a drag is a plain click on the row.
      if (!current.dragging) {
        onOpenCard(current.cardId);
        return;
      }
      // A viewer's ghost still travelled; the drop does nothing, which is the
      // same answer the capability matrix gives every other layout write.
      if (!canPlace) return;
      const canvas = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-testid="canvas-board"]');
      if (canvas) onDropAt(current.cardId, { x: event.clientX, y: event.clientY });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [onDropAt, onOpenCard, canPlace, setLibraryDrag]);

  const countsByFacet = facetCounts(scopedItems, typeFilter, tagFilter, activeSectionFilter);
  const facetFiltered = filterItems(scopedItems, typeFilter, tagFilter, activeSectionFilter);
  // A query replaces the facet-filtered list but never bypasses it: facets keep
  // narrowing the ranked hits, and the ranking order wins.
  const itemsById = new Map(scopedItems.map((item) => [item.id, item]));
  const facetIds = new Set(facetFiltered.map((item) => item.id));
  const searched = searching
    ? rankedIds.flatMap((id) => {
        const item = itemsById.get(id);
        return item !== undefined && facetIds.has(id) ? [item] : [];
      })
    : null;
  const visible = searched ?? facetFiltered;
  // An applied view carries its own order, the same rule `runView` uses:
  // relevance needs text, otherwise it reads like title.
  const ordered = useMemo(() => {
    const order = activeView?.query.order;
    if (!order || (order === "relevance" && searching)) return visible;
    const byTitle = (a: LibraryItem, b: LibraryItem) =>
      a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (order === "updated") {
      const updatedAt = (item: LibraryItem) => workspace?.getCard(item.id)?.updatedAt ?? 0;
      return [...visible].sort((a, b) => updatedAt(b) - updatedAt(a) || byTitle(a, b));
    }
    return [...visible].sort(byTitle);
  }, [visible, activeView, searching, workspace]);
  const filtering = typeFilter.length > 0 || tagFilter.length > 0 || activeSectionFilter.length > 0;
  const grouped =
    boardScope && groupBySection && !searching ? groupSections(ordered, sectionOrder) : null;
  const wide = boardScope;
  const sectionsById = new Map(sectionOrder.map((section) => [section.id, section]));
  const activeId = searching ? ordered[Math.min(activeResult, ordered.length - 1)]?.id : undefined;

  if (!open) return null;

  // A card row only offers Locate when the card is on the board in front of the
  // reader, so a failed Locate is not a state a card row can reach: an unplaced
  // card has nowhere to pan to, and `Place` is the action it does have.
  const locateCard = (item: LibraryItem) => {
    setLocateMiss(null);
    onLocateCard(item.id);
  };

  /**
   * Whether this row's card is placed on the active board. Place and Locate are
   * one pair of meanings across the library and the inspector: a card already
   * here is located, a card that is not is placed.
   */
  const placedHere = (item: LibraryItem): boolean =>
    activeBoardId !== null && item.boards.some((board) => board.id === activeBoardId);

  const locateBoard = (board: LibraryBoard) => {
    if (onLocateBoard(board.id)) {
      setLocateMiss(null);
      return;
    }
    setLocateMiss(`\u201c${board.title}\u201d has no portal on this board.`);
  };

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!searching || ordered.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveResult((current) => (current + step + ordered.length) % ordered.length);
      return;
    }
    if (event.key === "Enter") {
      const target = ordered[Math.min(activeResult, ordered.length - 1)];
      if (target === undefined) return;
      event.preventDefault();
      onOpenCard(target.id);
    }
  };

  const sectionLabel = (item: LibraryItem): string => {
    const owner = item.sectionIds.find((id) => sectionsById.has(id));
    return owner ? (sectionsById.get(owner)?.title ?? "Untitled section") : "Unsorted";
  };

  const renderRow = (item: LibraryItem) => {
    const hit: SearchHit | undefined = searching ? hits.get(item.id) : undefined;
    const current = activeId === item.id;
    return (
      <li
        key={item.id}
        className="library-entry"
        data-row-id={item.id}
        data-active={current ? "true" : undefined}
        aria-current={current ? "true" : undefined}
        ref={current ? activeRow : undefined}
      >
        <div
          data-testid={`library-item-${item.id}`}
          className="library-row"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (
              (event.target as HTMLElement).closest(
                'button, input, textarea, select, [contenteditable="true"]',
              )
            ) {
              return;
            }
            // Keep the gesture from selecting text across the board.
            event.preventDefault();
            holdRef.current = {
              cardId: item.id,
              startX: event.clientX,
              startY: event.clientY,
              dragging: false,
            };
            setHold({ item, x: event.clientX, y: event.clientY });
          }}
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
            {tab === "trash" ? (
              canManageTrash ? (
                <>
                  <button
                    type="button"
                    className="library-action"
                    onClick={() => onRestore(item.id)}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="library-action text-red-600"
                    onClick={() => onDeleteForever(item.id)}
                  >
                    Delete
                  </button>
                </>
              ) : null
            ) : (
              <>
                {item.boards.length > 0 ? (
                  <button
                    type="button"
                    className="library-action"
                    onClick={() => onGoToBoard(item.boards[0]?.id ?? "")}
                  >
                    Open
                  </button>
                ) : null}
                {placedHere(item) ? (
                  <button
                    type="button"
                    className="library-action"
                    data-testid={`library-locate-${item.id}`}
                    onClick={() => locateCard(item)}
                  >
                    Locate
                  </button>
                ) : (
                  <button type="button" className="library-action" onClick={() => onPlace(item.id)}>
                    Place
                  </button>
                )}
                {canManageTrash ? (
                  <button
                    type="button"
                    className="library-action text-red-600"
                    onClick={() => onTrash(item.id)}
                  >
                    Trash
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </li>
    );
  };

  /**
   * A board row. Boards are global: every action here reaches the board itself,
   * and none of them removes it from this list (unlike a card leaving the inbox
   * when it is placed).
   */
  const renderBoardRow = (board: LibraryBoard) => (
    <li key={board.id} className="library-entry" data-row-id={board.id}>
      <div
        data-testid={`library-item-${board.id}`}
        data-board-open={board.open ? "true" : "false"}
        className="library-row"
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
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="library-action"
            data-testid={`library-board-open-${board.id}`}
            onClick={() => onOpenBoard(board.id)}
          >
            Open
          </button>
          <button
            type="button"
            className="library-action"
            data-testid={`library-board-place-${board.id}`}
            onClick={() => onPlaceBoard(board.id)}
          >
            Place
          </button>
          <button
            type="button"
            className="library-action"
            data-testid={`library-board-locate-${board.id}`}
            onClick={() => locateBoard(board)}
          >
            Locate
          </button>
          {onSetBoardTemplate ? (
            <button
              type="button"
              className="library-action"
              data-testid={`library-board-template-${board.id}`}
              onClick={() => onSetBoardTemplate(board.id, board.template !== true)}
            >
              {board.template === true ? "Stop being a template" : "Save as template"}
            </button>
          ) : null}
          <button
            type="button"
            className="library-action"
            data-testid={`library-board-unplace-${board.id}`}
            onClick={() => onUnplaceBoardCards(board.id)}
          >
            Unplace Cards
          </button>
          <button
            type="button"
            className="library-action text-red-600"
            data-testid={`library-board-delete-${board.id}`}
            onClick={() => setPendingDelete(board)}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );

  const entries: LibraryEntry[] =
    tab === "boards"
      ? visibleBoards.map((board) => ({ kind: "board", board }))
      : ordered.map((card) => ({ kind: "card", card }));
  const renderEntry = (entry: LibraryEntry) =>
    entry.kind === "board" ? renderBoardRow(entry.board) : renderRow(entry.card);

  const rows = grouped ? (
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
  ) : (
    <ul className="space-y-0.5">{entries.map(renderEntry)}</ul>
  );

  return createPortal(
    <div
      role="dialog"
      aria-label="Library"
      data-testid="library-drawer"
      data-wide={wide ? "true" : undefined}
      className="library-drawer"
    >
      <div className="library-header flex flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5">
        <div role="tablist" aria-label="Library sections" className="flex items-center gap-1">
          {TABS.filter((entry) => canManageTrash || entry.id !== "trash").map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              data-testid={`library-tab-${entry.id}`}
              className="library-tab"
              data-active={tab === entry.id ? "true" : undefined}
              onClick={() => onTab(entry.id)}
            >
              {entry.label}
              <span className="tabular-nums text-[var(--ink-muted)]">{counts[entry.id] ?? 0}</span>
            </button>
          ))}
        </div>

        {activeView ? (
          <span
            className="library-tab"
            data-active="true"
            data-testid="library-active-view"
            title="This list is filtered by a saved view"
          >
            <span aria-hidden="true" className="opacity-70">
              {"\u25c7"}
            </span>
            <span className="max-w-[10rem] truncate">{activeView.name}</span>
            <button
              type="button"
              aria-label={`Exit view ${activeView.name}`}
              data-testid="library-exit-view"
              className="-mr-1 ml-0.5 rounded px-0.5 hover:bg-black/10 dark:hover:bg-white/15"
              onClick={() => exitView()}
            >
              {"\u00d7"}
            </button>
          </span>
        ) : null}

        {tab === "cards" ? (
          <div className="library-scope" data-testid="library-scope">
            <button
              type="button"
              data-testid="library-scope-all"
              className="library-tab"
              data-active={scope === "all" ? "true" : undefined}
              aria-pressed={scope === "all"}
              onClick={() => onScope("all")}
            >
              All
            </button>
            <button
              type="button"
              data-testid="library-scope-board"
              className="library-tab max-w-[10rem]"
              data-active={scope === "board" ? "true" : undefined}
              aria-pressed={scope === "board"}
              disabled={!activeBoardId}
              title={activeBoardName ?? "Active board"}
              onClick={() => onScope("board")}
            >
              <span className="truncate">{activeBoardName ?? "Board"}</span>
            </button>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {tab === "inbox" ? (
            <button
              type="button"
              data-testid="library-new-card"
              className="library-action"
              onClick={onCreateInInbox}
            >
              New
            </button>
          ) : null}
          {tab === "trash" && canManageTrash && trash.length > 0 ? (
            <button
              type="button"
              data-testid="library-empty-trash"
              className="library-action text-red-600"
              onClick={onEmptyTrash}
            >
              Empty trash
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close library"
            className="library-action"
            onClick={onClose}
          >
            {"\u00d7"}
          </button>
        </div>
      </div>

      <div className="library-search flex items-center gap-1.5 border-b border-[var(--hairline)] px-2 py-1.5">
        <span aria-hidden="true" className="text-[12px] text-[var(--ink-muted)]">
          {"\u2315"}
        </span>
        <input
          ref={searchInput}
          type="search"
          value={query}
          data-testid="library-search"
          aria-label={tab === "boards" ? "Search boards" : "Search cards"}
          placeholder={tab === "boards" ? "Search boards" : "Search titles and notes"}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--ink-muted)]"
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={onSearchKey}
        />
        {query.length > 0 ? (
          <button
            type="button"
            aria-label="Clear search"
            data-testid="library-search-clear"
            className="library-action"
            onClick={() => updateQuery("")}
          >
            {"\u00d7"}
          </button>
        ) : null}
      </div>

      <div
        className="library-facets flex flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5"
        data-testid="library-facets"
        // Boards carry no types, tags or sections (ADR-0040), so the facet row
        // would be a row of zeroes.
        style={tab === "boards" ? { display: "none" } : undefined}
      >
        {types.map((type) => {
          const count = countsByFacet.types.get(type.id) ?? 0;
          const active = typeFilter.includes(type.id);
          return (
            <button
              key={type.id}
              type="button"
              aria-pressed={active}
              data-testid={`facet-type-${type.id}`}
              className="library-tab"
              data-active={active ? "true" : undefined}
              onClick={() => onToggleType(type.id)}
            >
              <span aria-hidden="true">{type.glyph}</span>
              {typePluralName(type)}
              <span className="tabular-nums text-[var(--ink-muted)]">{count}</span>
            </button>
          );
        })}

        {tags.length > 0 ? <span className="h-4 w-px bg-[var(--hairline)]" /> : null}

        {tags.map((tag) => {
          const count = countsByFacet.tags.get(tag.id) ?? 0;
          const active = tagFilter.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={active}
              data-testid={`facet-tag-${tag.id}`}
              className="library-tab"
              data-active={active ? "true" : undefined}
              onClick={() => onToggleTag(tag.id)}
            >
              #{tag.name}
              <span className="tabular-nums text-[var(--ink-muted)]">{count}</span>
            </button>
          );
        })}

        {boardScope ? (
          <>
            <span className="h-4 w-px bg-[var(--hairline)]" />
            {sectionOrder.map((section) => {
              const count = countsByFacet.sections.get(section.id) ?? 0;
              const active = sectionFilter.includes(section.id);
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`facet-section-${section.id}`}
                  data-depth={section.depth}
                  className="library-tab"
                  data-active={active ? "true" : undefined}
                  style={{ paddingLeft: 9 + section.depth * 10 }}
                  onClick={() => onToggleSection(section.id)}
                >
                  <span className="truncate">{section.title}</span>
                  <span className="tabular-nums text-[var(--ink-muted)]">{count}</span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={sectionFilter.includes(UNSORTED_SECTION)}
              data-testid={`facet-section-${UNSORTED_SECTION}`}
              className="library-tab"
              data-active={sectionFilter.includes(UNSORTED_SECTION) ? "true" : undefined}
              onClick={() => onToggleSection(UNSORTED_SECTION)}
            >
              Unsorted
              <span className="tabular-nums text-[var(--ink-muted)]">
                {countsByFacet.sections.get(UNSORTED_SECTION) ?? 0}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={groupBySection}
              data-testid="library-group-toggle"
              className="library-tab ml-auto"
              data-active={groupBySection ? "true" : undefined}
              onClick={onToggleGroup}
            >
              Group by section
            </button>
          </>
        ) : null}

        {filtering ? (
          <button
            type="button"
            className="library-action ml-auto"
            data-testid="clear-filters"
            onClick={onClearFilters}
          >
            Clear
          </button>
        ) : null}
      </div>

      {locateMiss ? (
        <p
          className="border-b border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)]"
          data-testid="library-locate-miss"
        >
          {locateMiss}
        </p>
      ) : null}

      <div className="library-list overflow-y-auto p-1.5">
        {tab === "boards" &&
        onUseBoardTemplate &&
        visibleTemplates.length + visibleStarters.length > 0 ? (
          <TemplateGallery
            templates={visibleTemplates}
            starters={visibleStarters}
            onUseTemplate={onUseBoardTemplate}
            onUseStarter={onUseStarter}
            onEditTemplate={onOpenBoard}
          />
        ) : null}
        {entries.length === 0 ? (
          <p
            className="px-2 py-6 text-center text-[12px] text-[var(--ink-muted)]"
            {...(searching ? { "data-testid": "library-search-empty" } : {})}
          >
            {tab === "boards"
              ? searching
                ? `No boards match \u201c${query.trim()}\u201d.`
                : "No boards yet."
              : searching
                ? `No cards match \u201c${query.trim()}\u201d.`
                : filtering
                  ? "No cards match these filters."
                  : tab === "inbox"
                    ? "Nothing in the inbox. Cards you take off a board land here."
                    : tab === "cards"
                      ? boardScope
                        ? "No cards on this board."
                        : "No cards yet."
                      : "Trash is empty."}
          </p>
        ) : (
          rows
        )}
      </div>

      {pendingDelete ? (
        <Dialog
          title="Delete board?"
          description={`${pendingDelete.title} has ${pendingDelete.cardCount} ${
            pendingDelete.cardCount === 1 ? "card" : "cards"
          } on it. Unplacing keeps the cards in the library; trashing sends this board's cards to the trash with it.`}
          onClose={() => setPendingDelete(null)}
          actions={[
            {
              label: "Unplace cards",
              primary: true,
              onSelect: () => onDeleteBoard(pendingDelete.id, "keep"),
            },
            {
              label: "Trash cards",
              danger: true,
              onSelect: () => onDeleteBoard(pendingDelete.id, "trash"),
            },
          ]}
        />
      ) : null}

      {hold ? (
        <div
          aria-hidden="true"
          data-testid="library-hold-ghost"
          className="library-ghost"
          style={{ left: hold.x, top: hold.y }}
        >
          {hold.item.title}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
