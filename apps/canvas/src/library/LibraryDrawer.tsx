import type { WorkspaceMediaItem } from "@suite/graph";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { NewThingMenu } from "../chrome/NewThingMenu";
import { newThingMenuModel } from "../chrome/newThingMenu";
import { useSavedViews } from "../chrome/ViewsBar";
import { LIBRARY_SEARCH_FOCUS_EVENT } from "../hooks/useLibrarySearch";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { viewsEnabled } from "../views/availability";
import { LibraryFacets } from "./LibraryFacets";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryList } from "./LibraryList";
import { LibraryMediaList } from "./LibraryMediaList";
import { LibraryOverlays } from "./LibraryOverlays";
import { type LibraryRowContext, LibraryRowList } from "./LibraryRows";
import { LibrarySearchRow } from "./LibrarySearchRow";
import { LibrarySelectionBar } from "./LibrarySelectionBar";
import {
  isBoardItem,
  type LibraryBoard,
  type LibraryDrawerProps,
  type LibraryEntry,
  type LibraryItem,
} from "./libraryTypes";
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
  media = [],
  trashedMedia = [],
  onTrashMedia,
  onRestoreMedia,
  onDeleteMediaForever,
  onPlaceMediaAsCard,
  boards = [],
  /** Absent when this session may not create boards. */
  onCreateBoard,
  onCreateCard,
  onCreateSketch,
  onCreateSection,
  onCreatePortal,
  onOpenBoard = () => {},
  onPlaceBoard = () => {},
  onUnplaceBoardCards = () => {},
  onDeleteBoard = () => {},
  onLocateCard = () => false,
  onLocateBoard = () => false,
  onUseBoardTemplate: _onUseBoardTemplate,
  onUseStarter: _onUseStarter,
  onSetBoardTemplate,
  onManageTypes,
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
  onPlaceCards,
  canManageTrash = true,
  workspace: workspaceProp = null,
  initialQuery = "",
}: LibraryDrawerProps) {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = workspaceProp ?? storeWorkspace;
  const activeViewId = useUiStore((state) => state.activeViewId);
  const exitView = useUiStore((state) => state.exitView);
  const setLibraryQuery = useUiStore((state) => state.setLibraryQuery);
  const views = useSavedViews(workspace);
  const openNewView = useViewsStore((state) => state.openNew);
  const newView = useCallback(() => openNewView(views.length), [openNewView, views.length]);
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
  /** The "+ Add new" menu, which opens over the list from the control at its top. */
  const [addNew, setAddNew] = useState(false);
  /** The portal row's submenu, which is the same list of board targets the dock shows. */
  const [addNewPortal, setAddNewPortal] = useState(false);
  const addNewMenu = useRef<HTMLDivElement | null>(null);
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
    visibleTemplates: _visibleTemplates,
    visibleStarters: _visibleStarters,
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
    // A board dragged onto the canvas becomes a portal at the drop point, which
    // is the same gesture a card makes: the row lifts, the canvas receives it.
    // The whole pick goes to the canvas, which resolves a board row into the portal
    // that opens it. Special-casing one row here is how a mixed selection dropped a
    // single board and lost every card beside it.
    onDropAt: (ids, point) => {
      if (ids.length > 0) onDropAt(ids, point);
    },
    onOpen: (id) => {
      const item = ordered.find((entry) => entry.id === id);
      if (item !== undefined && isBoardItem(item)) {
        onOpenBoard(id);
        return;
      }
      onOpenCard(id);
    },
    // In selection mode a click on a picked row unpicks it, the way every list works;
    // it must not open the card the reader was sorting through.
    onTap: (id, event) => {
      if (!selecting) {
        const item = ordered.find((entry) => entry.id === id);
        if (item !== undefined && isBoardItem(item)) onOpenBoard(id);
        else onOpenCard(id);
        return;
      }
      selectRow(id, event);
    },
    canPlace,
    // A media row names media, not a card, until the drag starts. Resolving it here
    // means the gesture carries a real card id and nothing downstream learns about
    // media: the ghost, the peer layer, the drop and undo all see a card.
    resolveDraggedIds: (rowId) => {
      const item = media.find((entry) => entry.id === rowId);
      if (item === undefined || onPlaceMediaAsCard === undefined) return null;
      const cardId = onPlaceMediaAsCard(item);
      return cardId === undefined ? null : [cardId];
    },
  });

  /**
   * A drag in flight, read from the store rather than from this component: the canvas is
   * what publishes it (it owns the camera, so a screen point has to be converted before
   * presence sees one), and it is cleared on release wherever the release lands.
   */
  const dragging = useUiStore((state) => state.libraryDrag !== null);

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
    setAddNew(false);
    setAddNewPortal(false);
  }, open && addNew);

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
    if (!open) return;
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
  }, [open, onClose]);

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
    shiftHeld,
    toggleSelecting,
    clear: clearSelection,
    selectAll: selectAllRows,
  } = useLibrarySelection({ tab, ordered });

  // Shift over the open drawer borrows the multi-select UI; a pick keeps it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      // Shift is half of a shortcut too (⌘⇧K opens the library): only a plain
      // Shift press is a request for the multi-select UI.
      if (event.type === "keydown" && (event.metaKey || event.ctrlKey || event.altKey)) return;
      shiftHeld(event.type === "keydown");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [shiftHeld]);

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
    // Selection mode claims the press, and so does a modifier: shift or ctrl/cmd
    // is unambiguously "pick rows", which is how every list on the desktop works.
    // A drag-to-place here would be a second meaning for the same gesture.
    // A row that is already picked carries the whole pick: dragging one of the
    // selected rows out is how a stack leaves the drawer, and a press that quietly
    // discarded the selection first would make it useless the moment it was used.
    // An *unpicked* row in selection mode is a pick, which is how a selection is built.
    const picked = selection.ids.includes(item.id);
    if (!picked && (selecting || event.shiftKey || event.metaKey || event.ctrlKey)) {
      selectRow(item.id, event);
      return;
    }
    const carried = picked ? selectableOrder.filter((id) => selection.ids.includes(id)) : [item.id];
    holdRef.current = {
      rowId: item.id,
      title: item.title,
      cardIds: carried,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    setHold({ title: item.title, x: event.clientX, y: event.clientY });
  };

  /**
   * The press that lifts a media row.
   *
   * Media has no card until the drag resolves one, so the hold starts with no ids: the
   * first move past the threshold asks `resolveDraggedIds`, which makes the card. A
   * press that never moves stays a plain click and creates nothing.
   */
  const pressMediaRow = (item: WorkspaceMediaItem, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    const title = item.name ?? item.mime ?? "Media";
    holdRef.current = {
      rowId: item.id,
      title,
      cardIds: [],
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    setHold({ title, x: event.clientX, y: event.clientY });
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
    // A board row opens the board it names; a card row opens the card. The
    // gesture is the same, so the row does not need to know which it is.
    onOpen: (id) => {
      const item = ordered.find((entry) => entry.id === id);
      if (item && isBoardItem(item)) onOpenBoard(id);
      else onOpenCard(id);
    },
    // A board row's second line: where it is and how much is on it. Read from
    // the same item the list was built from, so the two cannot disagree.
    boardState: (boardId) => {
      const item = ordered.find((entry) => entry.id === boardId);
      if (item === undefined || !isBoardItem(item)) return undefined;
      return {
        open: boardId === activeBoardId,
        cardCount: (item as { cardCount?: number }).cardCount ?? 0,
      };
    },
  };

  /**
   * The same menu the dock opens, from the top of the list. A reader who came here
   * to start something should not have to close the drawer and find the pill, and
   * an empty workspace has no row to act on at all.
   */
  const addNewModel = newThingMenuModel({
    types,
    boards: boards.map((board) => ({ id: board.id, name: board.title })),
    activeBoardId,
    libraryOpen: true,
    canCreateContent: onCreateCard !== undefined,
    canCreateBoards: onCreateBoard !== undefined,
    handlers: {
      ...(onCreateSketch === undefined ? {} : { createSketch: onCreateSketch }),
      ...(onCreateSection === undefined ? {} : { createSection: onCreateSection }),
      ...(onCreatePortal === undefined ? {} : { createPortal: onCreatePortal }),
      ...(onCreateBoard === undefined ? {} : { createBoard: onCreateBoard }),
    },
  });
  /** What a new thing does once it exists: the drawer steps aside so it is in view. */
  const madeSomething = () => {
    setAddNew(false);
    setAddNewPortal(false);
    onClose();
  };

  // One list. A board is an item like a card, so the row shape follows the item
  // rather than the tab.
  const entries: LibraryEntry[] = ordered.map((item) => ({
    kind: isBoardItem(item) ? "board" : "card",
    card: item,
  }));

  return createPortal(
    <div
      role="dialog"
      aria-label="Library"
      data-testid="library-drawer"
      data-handbook-region="library-drawer"
      data-wide={boardScope ? "true" : undefined}
      data-full={full ? "true" : undefined}
      /**
       * A row being dragged out of the drawer takes the drawer with it.
       *
       * The ghost follows the pointer to the board, and the drawer is exactly what it
       * would be dropped on: a panel floating under the cursor turns every drop into a
       * miss. So it steps aside while a drag is in flight and comes back on release —
       * including a release that placed nothing, which is the same "nothing happened"
       * the reader expects.
       */
      data-dragging={dragging ? "true" : undefined}
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
        onManageTypes={onManageTypes}
        onNewView={viewsEnabled ? newView : undefined}
        onCreateInInbox={onCreateInInbox}
        trashCount={trash.length}
        onEmptyTrash={onEmptyTrash}
        onClose={onClose}
      />

      {/* The selection bar replaces the search row while a selection exists: what a
          reader picks rows for is acting on them together. */}
      {tab === "media" ? (
        <LibraryMediaList
          items={media}
          onTrash={onTrashMedia}
          canManage={canManageTrash}
          onPlaceAsCard={onPlaceMediaAsCard}
          onPressRow={pressMediaRow}
          onOpenCard={onOpenCard}
        />
      ) : (
        <>
          {selecting || selection.ids.length > 0 ? (
            <LibrarySelectionBar
              selected={selected}
              canManageTrash={canManageTrash}
              onPlace={onPlaceCards}
              onTrash={onTrash}
              onSelectAll={selectAllRows}
              onClear={clearSelection}
            />
          ) : null}

          <LibrarySearchRow
            inputRef={searchInput}
            query={query}
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

          {/* The same menu the dock opens. A reader who came to the library to start
              something should not have to put the drawer away and go find the pill, and
              a workspace with no rows yet has nothing here to act on at all. It sits
              above the list rather than inside it: the list scrolls and clips, and a
              menu is not something to scroll past. */}
          <div ref={addNewMenu} className="relative px-1.5 pt-1">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={addNew}
              data-testid="library-add-new"
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
              onClick={() => {
                setAddNew((openNow) => !openNow);
                setAddNewPortal(false);
              }}
            >
              <span aria-hidden="true">+</span> Add new
            </button>
            {addNew ? (
              <div className="absolute left-1.5 top-full z-20">
                <NewThingMenu
                  model={addNewModel}
                  direction="down"
                  prefix="library"
                  onCreateCard={(typeId) => {
                    madeSomething();
                    onCreateCard?.(typeId);
                  }}
                  portalOpen={addNewPortal}
                  onTogglePortal={() => setAddNewPortal((openNow) => !openNow)}
                  onDone={madeSomething}
                />
              </div>
            ) : null}
          </div>

          <LibraryList
            tab={tab}
            boardScope={boardScope}
            searching={searching}
            query={query}
            filtering={filtering}
            entryCount={entries.length}
            truncated={truncated}
            rows={<LibraryRowList entries={entries} grouped={grouped} context={rowContext} />}
          />

          {tab === "trash" && trashedMedia.length > 0 ? (
            <div
              className="border-t border-[var(--hairline)] p-2"
              data-testid="library-trashed-media"
            >
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                Trashed Media ({trashedMedia.length})
              </h4>
              <div className="flex flex-col gap-1">
                {trashedMedia.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded border border-[var(--hairline)] p-1.5 text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="rounded bg-[var(--surface-muted)] px-1 font-mono text-[9px] uppercase text-[var(--ink-muted)]">
                        {item.kind}
                      </span>
                      <span className="truncate font-medium text-[var(--ink)]">
                        {item.name || item.id}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {onRestoreMedia ? (
                        <button
                          type="button"
                          onClick={() => onRestoreMedia(item.id)}
                          data-testid={`restore-media-${item.id}`}
                          className="text-[10px] text-[var(--brand)] hover:underline"
                        >
                          Restore
                        </button>
                      ) : null}
                      {onDeleteMediaForever ? (
                        <button
                          type="button"
                          onClick={() => onDeleteMediaForever(item.id)}
                          data-testid={`delete-forever-media-${item.id}`}
                          className="text-[10px] text-red-600 hover:underline"
                        >
                          Delete forever
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

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
