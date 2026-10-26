import type { CardType, PropertyValue, SearchHit, Tag, WorkspaceDocument } from "@suite/graph";
import { highlightRanges, isBehaviourType, typePluralName } from "@suite/graph";
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
import type { CanvasMode } from "../canvas/linkGesture";
import { LIBRARY_SEARCH_FOCUS_EVENT, useLibrarySearch } from "../hooks/useLibrarySearch";
import { useCanvasStore } from "../store/useCanvasStore";
import type { LibraryScope, LibraryTab } from "../store/useUiStore";
import { useUiStore } from "../store/useUiStore";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Dialog } from "./Dialog";
import {
  facetCounts,
  filterItems,
  groupBySection as groupSections,
  type SectionOrderEntry,
  UNSORTED_SECTION,
} from "./libraryFilters";
import {
  applySelection,
  EMPTY_SELECTION,
  gestureOf,
  type SelectionState,
  selectAll,
  selectedInOrder,
} from "./librarySelection";
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
  /** The drawer is taking the whole window; the toggle lives in its header. */
  full: boolean;
  onFull: (full: boolean) => void;
  sectionFilter: string[];
  onToggleSection: (id: string) => void;
  /** Sections of the active board in outline order. */
  sectionOrder: SectionOrderEntry[];
  groupBySection: boolean;
  onToggleGroup: () => void;
  /** Opens a card in the inspector; rows never expand in place. */
  onOpenCard: (cardId: string) => void;
  /**
   * Run the selection in one shape: the verb *is* the mode (ADR-0063), so a caller
   * sets the mode and starts the run in one go.
   */
  onRunCards?: ((cardIds: readonly string[], mode: CanvasMode) => void) | undefined;
  /** True while a run is placing, so a row's Place verb joins it instead of starting one. */
  runActive?: boolean;
  /** Add cards to the live run: the picker loop's other half. */
  onQueueCards?: ((cardIds: readonly string[]) => void) | undefined;
  /**
   * Start a picker loop: place one card and stay live, so every later pick joins
   * the same sequence.
   */
  onRunLoop?: ((cardIds: readonly string[]) => void) | undefined;
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

/** The verb a run's shape is called when it applies to a set of rows. */
const VERB_LABELS: Record<CanvasMode, string> = {
  place: "Place",
  thread: "Thread",
  fan: "Fan",
  branch: "Branch",
};

/**
 * The overflow button every row carries.
 *
 * A row offered up to six buttons in a drawer a few hundred pixels wide, which
 * pushed the entity's own title out of the row — the one thing the row exists to
 * show ([ADR-0011](docs/decisions/0011-library-dock-and-card-chrome.md) §6). The
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

/**
 * Cards answer for the tags of the section they sit in as well as their own
 * ([ADR-0053 §6](../../../../docs/decisions/0053-supertags-are-multi-type.md)).
 * Read-only: section membership still comes from geometry alone.
 */
function withSectionTags(items: LibraryItem[], workspace: WorkspaceDocument | null): LibraryItem[] {
  if (!workspace) return items;
  const tagsBySection = new Map<string, string[]>();
  for (const section of workspace.listSections()) {
    if (section.tags.length > 0) tagsBySection.set(section.id, section.tags);
  }
  if (tagsBySection.size === 0) return items;
  return items.map((item) => {
    const inherited = item.sectionIds.flatMap((id) => tagsBySection.get(id) ?? []);
    if (inherited.length === 0) return item;
    // A card can also carry the tag itself; the facet counts a card once.
    return { ...item, tagIds: [...new Set([...item.tagIds, ...inherited])] };
  });
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
  full,
  onFull,
  sectionFilter,
  onToggleSection,
  sectionOrder,
  groupBySection,
  onToggleGroup,
  onOpenCard,
  onRunCards,
  runActive = false,
  onQueueCards,
  onRunLoop,
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
  /**
   * A run is "I am about to place a set", and the set comes from here, so the
   * purpose opens the drawer already selecting (ADR-0064 §8). Read from the store
   * rather than taken as a prop: the drawer already reads the library's own state
   * from it, and the purpose can change while the drawer is open, so a prop would
   * leave the caller keeping two states in sync.
   */
  const running = useUiStore((state) => state.purpose === "run");
  const views = useSavedViews(workspace);
  const activeView = views.find((view) => view.id === activeViewId);
  const [hold, setHold] = useState<{ item: LibraryItem; x: number; y: number } | null>(null);
  const [activeResult, setActiveResult] = useState(0);
  /** A Locate that found nothing says so instead of moving the camera. */
  const [locateMiss, setLocateMiss] = useState<string | null>(null);
  /** The board whose delete is being asked about; the only place a board is deleted. */
  const [pendingDelete, setPendingDelete] = useState<LibraryBoard | null>(null);
  /**
   * The row whose actions menu is open, and where it opened. One piece of state
   * for both rows and both entry points (the ⋯ button and a right-click), so the
   * two can never show different actions for the same row.
   */
  /**
   * Row selection: the input every bulk action and every run shares (ADR-0011
   * amendment, ADR-0063). It is drawer state, not document state — nothing about a
   * selection is stored.
   */
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  /**
   * Selection mode. A plain click opens a card — that is the drawer's dominant
   * gesture — so bulk selection is opted into with one button rather than inferred
   * from a modifier, and the mode says so in the header while it is on.
   */
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    // Leaving a run leaves selection mode with it: a selection made for a run
    // means nothing once the run has ended (ADR-0064 §10). Only a purpose change
    // runs this, so a reader who turned the mode on themselves keeps it.
    setSelecting(running);
  }, [running]);
  const [rowMenu, setRowMenu] = useState<{
    id: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);
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

  // A card answers for its section's tags too, so a section tag is a lens target
  // rather than decoration (ADR-0053 §6). The drawer and the canvas lens read
  // the same rule; neither writes a placement, so membership cannot change.
  const filterable = withSectionTags(scopedItems, workspace);
  const countsByFacet = facetCounts(filterable, typeFilter, tagFilter, activeSectionFilter);
  const facetFiltered = filterItems(filterable, typeFilter, tagFilter, activeSectionFilter);
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

  /**
   * The actions for one row, in one place. The ⋯ button and a right-click both
   * read this, so the menu can never offer a different set depending on how it
   * was opened, and the list stays the whole truth about what a row can do.
   */
  const menuFor = (id: string): ContextMenuItem[] => {
    const card = tab === "boards" ? undefined : ordered.find((entry) => entry.id === id);
    const board = tab === "boards" ? visibleBoards.find((entry) => entry.id === id) : undefined;

    if (board) {
      return [
        { label: "Open", onSelect: () => onOpenBoard(board.id) },
        { label: "Place on board", onSelect: () => onPlaceBoard(board.id) },
        { label: "Locate", onSelect: () => locateBoard(board) },
        ...(onSetBoardTemplate
          ? [
              {
                label: board.template === true ? "Stop being a template" : "Save as template",
                onSelect: () => onSetBoardTemplate(board.id, board.template !== true),
              },
            ]
          : []),
        { label: "Unplace its cards", onSelect: () => onUnplaceBoardCards(board.id) },
        { label: "Delete board…", danger: true, onSelect: () => setPendingDelete(board) },
      ];
    }

    if (!card) return [];
    if (tab === "trash") {
      if (!canManageTrash) return [];
      return [
        { label: "Restore", onSelect: () => onRestore(card.id) },
        { label: "Delete forever", danger: true, onSelect: () => onDeleteForever(card.id) },
      ];
    }
    return [
      { label: "Open details", onSelect: () => onOpenCard(card.id) },
      ...(card.boards.length > 0
        ? [{ label: "Go to board", onSelect: () => onGoToBoard(card.boards[0]?.id ?? "") }]
        : []),
      placedHere(card)
        ? { label: "Locate", onSelect: () => locateCard(card) }
        : {
            // While a run is live, picking another card is the loop: it joins the
            // sequence instead of starting a second run beside it (ADR-0063 §6).
            label: runActive ? "Place next" : "Place on board",
            onSelect: () => (runActive ? onQueueCards?.([card.id]) : onPlace(card.id)),
          },
      ...(canManageTrash
        ? [{ label: "Move to trash", danger: true, onSelect: () => onTrash(card.id) }]
        : []),
    ];
  };

  const openRowMenu = (
    id: string,
    label: string,
    point: { x: number; y: number },
    event?: React.MouseEvent,
  ) => {
    event?.preventDefault();
    event?.stopPropagation();
    setRowMenu({ id, label, ...point });
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

  /**
   * The rows a selection can hold, in the order on screen. A run places in this
   * order, which is why it is derived from the rendered list rather than stored.
   */
  const selectableOrder = tab === "cards" || tab === "inbox" ? ordered.map((item) => item.id) : [];

  const selectRow = (id: string, event: React.PointerEvent | React.MouseEvent) => {
    const gesture = gestureOf({
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    });
    setSelection((current) => applySelection(current, id, gesture, selectableOrder));
  };

  const runVerb = (mode: CanvasMode) => {
    const ids = selectedInOrder(selection, selectableOrder);
    if (ids.length === 0) return;
    onRunCards?.(ids, mode);
    // A run is now live; the selection has done its job.
    setSelection(EMPTY_SELECTION);
    setSelecting(false);
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
        data-selected={selection.ids.includes(item.id) ? "true" : undefined}
        aria-current={current ? "true" : undefined}
        ref={current ? activeRow : undefined}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the row is a canvas-like list item whose right-click opens the same menu its ⋯ button does; the button is the keyboard path. */}
        <div
          data-testid={`library-item-${item.id}`}
          className="library-row"
          onContextMenu={(event) =>
            openRowMenu(item.id, item.title, { x: event.clientX, y: event.clientY }, event)
          }
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
            if (selecting) {
              // Selection mode claims the press: a drag-to-place here would be a
              // second meaning for the same gesture (ADR-0011 amendment).
              selectRow(item.id, event);
              return;
            }
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
            <RowMenuButton
              id={item.id}
              label={item.title}
              onOpen={(point) => setRowMenu({ id: item.id, label: item.title, ...point })}
            />
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same as a card row — the ⋯ button is the keyboard path to this menu. */}
      <div
        data-testid={`library-item-${board.id}`}
        data-board-open={board.open ? "true" : "false"}
        className="library-row"
        onContextMenu={(event) =>
          openRowMenu(board.id, board.title, { x: event.clientX, y: event.clientY }, event)
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
                says it in words: a template is a fact about the board, not only
                something you can toggle. */}
            {board.template === true ? (
              <span data-testid={`library-board-template-${board.id}`}>{" \u00b7 template"}</span>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <RowMenuButton
            id={board.id}
            label={board.title}
            onOpen={(point) => setRowMenu({ id: board.id, label: board.title, ...point })}
          />
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
      data-full={full ? "true" : undefined}
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
          {/* The drawer floats so a row can be dragged onto the board beside it; a
              library with six sections is also a browser, and browsing wants the
              window. Both are the same component and the same rows, and this is
              one button in the header's action group rather than a second mode. */}
          <button
            type="button"
            aria-pressed={full}
            aria-label={full ? "Restore the library drawer" : "Expand the library"}
            title={full ? "Restore the library drawer" : "Expand the library"}
            data-testid="library-expand"
            className="library-action"
            onClick={() => onFull(!full)}
          >
            {/* Bidirectional arrows rather than a box or a cross: a cross next to
                the drawer's own close button would read as a second close. */}
            {full ? "\u2921" : "\u2922"}
          </button>
          {selectableOrder.length > 0 || selecting ? (
            <button
              type="button"
              aria-pressed={selecting}
              data-testid="library-select-toggle"
              className="library-action"
              data-active={selecting ? "true" : undefined}
              title={selecting ? "Leave selection" : "Select rows to act on them together"}
              onClick={() => {
                setSelecting((on) => !on);
                setSelection(EMPTY_SELECTION);
              }}
            >
              Select
            </button>
          ) : null}
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

      {/* The selection bar replaces the search row while a selection exists: the
          verbs are the reason the rows were selected, and a run starts from here. */}
      {selecting || selection.ids.length > 0 ? (
        <div
          className="library-selection flex flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5"
          data-testid="library-selection"
        >
          <span
            className="mr-1 text-[11px] font-medium text-[var(--ink)]"
            data-testid="library-selection-count"
          >
            {`${selection.ids.length} selected`}
          </span>
          {selection.ids.length === 0 ? (
            // The bar appears with the mode, not with the first row: an empty mode
            // with no visible verbs is a mode a reader has to guess at.
            <span className="mr-1 text-[11px] text-[var(--ink-muted)]">
              Pick rows to act on them together
            </span>
          ) : null}
          {(["place", "thread", "fan", "branch"] as const).map((verb) => (
            <button
              key={verb}
              type="button"
              className="library-action"
              data-testid={`library-run-${verb}`}
              disabled={selection.ids.length === 0}
              // The verb is the mode: "Thread cards" is thread mode plus a queue.
              onClick={() => runVerb(verb)}
            >
              {`${VERB_LABELS[verb]} cards`}
            </button>
          ))}
          <button
            type="button"
            className="library-action"
            data-testid="library-run-loop"
            disabled={selection.ids.length === 0}
            title="Place these one at a time, coming back here for the next"
            onClick={() => {
              // The loop places one and stays live, so the next pick joins the same
              // sequence instead of starting another (ADR-0063 §6).
              const ids = selectedInOrder(selection, selectableOrder);
              if (ids.length === 0) return;
              onRunLoop?.(ids);
              setSelection(EMPTY_SELECTION);
              setSelecting(false);
            }}
          >
            One at a time
          </button>
          {canManageTrash ? (
            <button
              type="button"
              className="library-action text-red-600"
              data-testid="library-selection-trash"
              disabled={selection.ids.length === 0}
              onClick={() => {
                for (const id of selectedInOrder(selection, selectableOrder)) onTrash(id);
                setSelection(EMPTY_SELECTION);
              }}
            >
              Trash
            </button>
          ) : null}
          <button
            type="button"
            className="ml-auto library-action"
            data-testid="library-selection-all"
            onClick={() => setSelection(selectAll(selectableOrder))}
          >
            All
          </button>
          <button
            type="button"
            className="library-action"
            data-testid="library-selection-clear"
            onClick={() => setSelection(EMPTY_SELECTION)}
          >
            Clear
          </button>
        </div>
      ) : null}

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
        // The facet row filters cards. A board row is not a card, so the row
        // would be a row of zeroes here even though boards now carry tags.
        style={tab === "boards" ? { display: "none" } : undefined}
      >
        {/* A behaviour is not a facet (ADR-0011 §3): offering Sketch or Portal here
            reads as "author your own Sketch type", which the model forbids. A
            sketch is found in its own section; a portal is that board's presence. */}
        {types
          .filter((type) => !isBehaviourType(type.id))
          .map((type) => {
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

      {/* One menu for every row, opened by its ⋯ button or by right-clicking it.
          Rendered through the drawer's own portal so it stacks with the drawer
          rather than under the canvas. */}
      {rowMenu ? (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={menuFor(rowMenu.id)}
          onClose={() => setRowMenu(null)}
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
