import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePlacementRunStore } from "../canvas/placementRun";
import { useSavedViews } from "../chrome/ViewsBar";
import { LIBRARY_SEARCH_FOCUS_EVENT } from "../hooks/useLibrarySearch";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { LibraryFacets } from "./LibraryFacets";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryList } from "./LibraryList";
import { LibraryOverlays } from "./LibraryOverlays";
import { type LibraryRowContext, LibraryRowList } from "./LibraryRows";
import { LibrarySearchRow } from "./LibrarySearchRow";
import { LibrarySelectionBar } from "./LibrarySelectionBar";
import type { LibraryBoard, LibraryDrawerProps, LibraryEntry, LibraryItem } from "./libraryTypes";
import { useLibraryHold } from "./useLibraryHold";
import { type LibrarySort, useLibraryList } from "./useLibraryList";
import { useLibraryRowActions } from "./useLibraryRowActions";
import { useLibrarySelection } from "./useLibrarySelection";

export type { LibraryBoard, LibraryDrawerProps, LibraryEntry, LibraryItem } from "./libraryTypes";

/**
 * What a press has to land on to *not* dismiss the drawer: the drawer, the button
 * that toggles it, and the menu and dialogs it portals out of its own tree. A row
 * menu's backdrop is deliberately absent — pressing off the menu closes the menu,
 * and the library with it.
 */
const LIBRARY_PRESS_KEEP =
  '[data-testid="library-drawer"], [data-testid="dock-library"], [data-testid="context-menu"], [data-testid="dialog"]';

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
  /**
   * A run is "I am about to place a set", and the set comes from here, so the
   * purpose opens the drawer already selecting (ADR-0064 §8). Read from the store
   * rather than taken as a prop: the drawer already reads the library's own state
   * from it, and the purpose can change while the drawer is open, so a prop would
   * leave the caller keeping two states in sync.
   */
  const running = useUiStore((state) => state.purpose === "run");
  /**
   * A card in hand makes the canvas press the run's, not a dismissal: the drawer
   * stays open behind a run because it is where the next card comes from.
   */
  const holdingCard = usePlacementRunStore((state) => state.run !== null);
  const views = useSavedViews(workspace);
  const activeView = views.find((view) => view.id === activeViewId);
  const [activeResult, setActiveResult] = useState(0);
  /**
   * The list's order. A saved view carries its own when it is applied, so this
   * starts wherever the last view left it and the reader can change it after.
   */
  const [sort, setSort] = useState<LibrarySort>("title");
  /** A Locate that found nothing says so instead of moving the camera. */
  const [locateMiss, setLocateMiss] = useState<string | null>(null);
  /** The board whose delete is being asked about; the only place a board is deleted. */
  const [pendingDelete, setPendingDelete] = useState<LibraryBoard | null>(null);
  /** The trashed card whose permanent delete is being asked about. */
  const [pendingPurge, setPendingPurge] = useState<{ id: string; title: string } | null>(null);
  /**
   * The row whose actions menu is open, and where it opened. One piece of state
   * for both rows and both entry points (the ⋯ button and a right-click), so the
   * two can never show different actions for the same row.
   */
  const [rowMenu, setRowMenu] = useState<{
    id: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const activeRow = useRef<HTMLLIElement | null>(null);
  const focusPending = useRef(false);
  const {
    query,
    setQuery,
    searching,
    terms,
    hits,
    boardScope,
    countsByFacet,
    ordered,
    filtering,
    truncated,
    grouped,
    sectionsById,
    visibleBoards,
    visibleTemplates,
    visibleStarters,
  } = useLibraryList({
    tab,
    scope,
    activeBoardId,
    inbox,
    cards,
    trash,
    boards,
    starters,
    typeFilter,
    tagFilter,
    sectionFilter,
    sectionOrder,
    groupBySection,
    workspace,
    sort,
    initialQuery,
  });
  /** The keyboard cursor row, when a search is active. */
  const activeId = searching ? ordered[Math.min(activeResult, ordered.length - 1)]?.id : undefined;
  const sectionLabel = (item: LibraryItem): string => {
    const owner = item.sectionIds.find((id) => sectionsById.has(id));
    return owner ? (sectionsById.get(owner)?.title ?? "Untitled section") : "Unsorted";
  };
  const {
    hold,
    holdRef,
    setHold,
    reset: resetHold,
  } = useLibraryHold({
    onDropAt,
    onOpenCard,
    canPlace,
  });

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
    const query = workspace?.getView(activeViewId)?.query;
    updateQuery(query?.text ?? "");
    setSort(
      query?.order === "updated" ? "updated" : query?.order === "relevance" ? "relevance" : "title",
    );
  }, [activeViewId, workspace, updateQuery]);

  useEscapeLayer(() => {
    // The first Escape clears the query; only the next one closes the drawer.
    if (query.trim().length > 0) {
      updateQuery("");
      return;
    }
    onClose();
  }, open);

  /**
   * A press on the canvas closes the drawer: the canvas is what "outside" means here,
   * because it is the surface the drawer is standing in front of. On the pane the
   * press *is* the dismissal — it must not also place a card behind the drawer — while
   * a card and the chrome keep their press, because a control you aimed at is one you
   * meant to click, and the tab strip is not a way of putting the drawer away. The
   * trigger is exempt entirely (it toggles, and a dismissal followed by a toggle would
   * reopen what the press just closed), and so is everything the drawer itself opened:
   * its row menu and its dialogs are portalled out of its tree, so a press there is
   * still a press on the library.
   */
  useEffect(() => {
    if (!open || holdingCard) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(LIBRARY_PRESS_KEEP)) return;
      if (!target?.closest?.('[data-testid="canvas-board"]')) return;
      if (target.closest(".react-flow__pane")) {
        event.preventDefault();
        event.stopPropagation();
      }
      onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, holdingCard, onClose]);

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
      resetHold();
      setPendingDelete(null);
      setPendingPurge(null);
      setLocateMiss(null);
    }
  }, [open, resetHold]);

  const { menuFor } = useLibraryRowActions({
    tab,
    ordered,
    visibleBoards,
    activeBoardId,
    runActive,
    canManageTrash,
    onLocateCard,
    onLocateBoard,
    onOpenBoard,
    onPlaceBoard,
    onSetBoardTemplate,
    onUnplaceBoardCards,
    onRestore,
    onOpenCard,
    onGoToBoard,
    onPlace,
    onQueueCards,
    onTrash,
    setLocateMiss,
    setPendingDelete,
    setPendingPurge,
  });

  const openRowMenu = useCallback(
    (id: string, label: string, point: { x: number; y: number }, event?: React.MouseEvent) => {
      event?.preventDefault();
      event?.stopPropagation();
      setRowMenu({ id, label, ...point });
    },
    [],
  );

  const {
    selection,
    selecting,
    selected,
    selectableOrder,
    selectRow,
    toggleSelecting,
    clear: clearSelection,
    selectAll: selectAllRows,
    runVerb,
    runLoop: runSelectionLoop,
  } = useLibrarySelection({
    tab,
    ordered,
    running,
    onRunCards,
    onRunLoop,
  });

  if (!open) return null;

  const pressRow = (item: LibraryItem, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    // The row's own open button is part of the row's surface, so a press on the
    // title still lifts it; every other button (the ⋯) keeps its own press.
    if (target.closest("button:not([data-row-open])")) return;
    // Keep the gesture from selecting text across the board.
    event.preventDefault();
    if (selecting) {
      // Selection mode claims the press: a drag-to-place here would be a second
      // meaning for the same gesture (ADR-0011 amendment).
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
  };

  const rowContext: LibraryRowContext = {
    tags,
    searching,
    terms,
    hits,
    activeId,
    selectedIds: selection.ids,
    activeRow,
    boardScope,
    activeBoardName,
    sectionLabel,
    onOpenMenu: openRowMenu,
    onPressRow: pressRow,
    onOpenCard,
    onOpenBoard,
  };

  const entries: LibraryEntry[] =
    tab === "boards"
      ? visibleBoards.map((board) => ({ kind: "board", board }))
      : ordered.map((card) => ({ kind: "card", card }));

  return createPortal(
    <div
      role="dialog"
      aria-label="Library"
      data-testid="library-drawer"
      data-wide={boardScope ? "true" : undefined}
      data-full={full ? "true" : undefined}
      className="library-drawer"
    >
      <LibraryHeader
        tab={tab}
        counts={counts}
        canManageTrash={canManageTrash}
        onTab={onTab}
        activeViewName={activeView?.name ?? null}
        onExitView={() => exitView()}
        scope={scope}
        onScope={onScope}
        activeBoardId={activeBoardId}
        activeBoardName={activeBoardName}
        full={full}
        onFull={onFull}
        selectableCount={selectableOrder.length}
        selecting={selecting}
        onToggleSelecting={toggleSelecting}
        onCreateInInbox={onCreateInInbox}
        trashCount={trash.length}
        onEmptyTrash={onEmptyTrash}
        onClose={onClose}
      />

      {/* The selection bar replaces the search row while a selection exists: the
          verbs are the reason the rows were selected, and a run starts from here. */}
      {selecting || selection.ids.length > 0 ? (
        <LibrarySelectionBar
          selected={selected}
          canManageTrash={canManageTrash}
          onRun={runVerb}
          onRunLoop={runSelectionLoop}
          onTrash={onTrash}
          onSelectAll={selectAllRows}
          onClear={clearSelection}
        />
      ) : null}

      <LibrarySearchRow
        inputRef={searchInput}
        query={query}
        boardTab={tab === "boards"}
        onQuery={updateQuery}
        onNavigate={(step) =>
          setActiveResult((current) => (current + step + ordered.length) % ordered.length)
        }
        onPick={() => {
          const target = ordered[Math.min(activeResult, ordered.length - 1)];
          if (target !== undefined) onOpenCard(target.id);
        }}
        enabled={searching && ordered.length > 0}
        sort={sort}
        onSort={setSort}
      />

      <LibraryFacets
        tab={tab}
        types={types}
        tags={tags}
        countsByFacet={countsByFacet}
        boardScope={boardScope}
        sectionOrder={sectionOrder}
        typeFilter={typeFilter}
        tagFilter={tagFilter}
        sectionFilter={sectionFilter}
        groupBySection={groupBySection}
        filtering={filtering}
        onToggleType={onToggleType}
        onToggleTag={onToggleTag}
        onToggleSection={onToggleSection}
        onToggleGroup={onToggleGroup}
        onClearFilters={onClearFilters}
      />

      {locateMiss ? (
        <p
          className="border-b border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)]"
          data-testid="library-locate-miss"
        >
          {locateMiss}
        </p>
      ) : null}

      <LibraryList
        tab={tab}
        boardScope={boardScope}
        searching={searching}
        query={query}
        filtering={filtering}
        entryCount={entries.length}
        truncated={truncated}
        rows={<LibraryRowList entries={entries} grouped={grouped} context={rowContext} />}
        templates={visibleTemplates}
        starters={visibleStarters}
        onUseTemplate={onUseBoardTemplate}
        onUseStarter={onUseStarter}
        onEditTemplate={onOpenBoard}
      />

      <LibraryOverlays
        pendingPurge={pendingPurge}
        onDismissPurge={() => setPendingPurge(null)}
        onDeleteForever={(cardId) => {
          onDeleteForever(cardId);
          setPendingPurge(null);
        }}
        pendingDelete={pendingDelete}
        onDismissDelete={() => setPendingDelete(null)}
        onDeleteBoard={onDeleteBoard}
        rowMenu={rowMenu}
        menuItems={rowMenu ? menuFor(rowMenu.id) : []}
        onCloseMenu={() => setRowMenu(null)}
        hold={hold}
      />
    </div>,
    document.body,
  );
}
