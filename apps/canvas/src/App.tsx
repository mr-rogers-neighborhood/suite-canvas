import { sectionForCard, sectionMembership } from "@suite/graph";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardOutlineHost } from "./canvas/BoardOutline";
import { CanvasBoard } from "./canvas/CanvasBoard";
import { outlineRows } from "./canvas/outlineTree";
import { TAB_ID } from "./collab/tabId";
import { usePresenceStore } from "./collab/usePresenceStore";
import { BoardTabs } from "./components/BoardTabs";
import { CardInspectorHost } from "./components/CardInspectorHost";
import { sectionPath } from "./components/cardWhere";
import { Dialog } from "./components/Dialog";
import { Dock } from "./components/Dock";
import { LibraryDrawer, type LibraryItem } from "./components/LibraryDrawer";
import { UNSORTED_SECTION } from "./components/libraryFilters";
import { TitleBar } from "./components/TitleBar";
import { TypeSettingsHost } from "./components/TypeSettingsHost";
import { WorkspaceActions } from "./components/WorkspaceActions";
import { PerfOverlay } from "./dev/PerfOverlay";
import { countRender } from "./dev/perf";
import { WorkspaceLauncher } from "./launcher/WorkspaceLauncher";
import { rememberWorkspace } from "./session/workspaceTransfer";
import { resolveBoardId, useCanvasStore, WORKSPACE_ID } from "./store/useCanvasStore";
import { useUiStore } from "./store/useUiStore";
import { useWorkspaceSnapshot } from "./store/workspaceStore";
import { initTheme } from "./theme/useThemeStore";

/** Card glyph box in flow units: `w-56` wide, tall enough for a header + one line. */
const CARD_HALF_WIDTH = 112;
const CARD_HALF_HEIGHT = 40;

export default function App() {
  useEffect(() => initTheme(), []);

  const workspaceId = WORKSPACE_ID;
  if (!workspaceId) return <WorkspaceLauncher />;

  return (
    <ReactFlowProvider>
      <WorkspaceShell workspaceId={workspaceId} />
    </ReactFlowProvider>
  );
}

function WorkspaceShell({ workspaceId }: { workspaceId: string }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const connect = useCanvasStore((state) => state.connect);
  const provider = useCanvasStore((state) => state.provider);
  const presence = useCanvasStore((state) => state.presence);
  const status = useCanvasStore((state) => state.status);
  const ready = useCanvasStore((state) => state.ready);
  const synced = useCanvasStore((state) => state.synced);
  const { screenToFlowPosition } = useReactFlow();
  const snapshot = useWorkspaceSnapshot();

  countRender("shell");

  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const setActiveBoardId = useUiStore((state) => state.setActiveBoardId);
  const libraryOpen = useUiStore((state) => state.libraryOpen);
  const libraryTab = useUiStore((state) => state.libraryTab);
  const setLibraryOpen = useUiStore((state) => state.setLibraryOpen);
  const setLibraryTab = useUiStore((state) => state.setLibraryTab);
  const startEditing = useUiStore((state) => state.startEditing);
  const openTypeSettings = useUiStore((state) => state.openTypeSettings);
  const libraryTypeFilter = useUiStore((state) => state.libraryTypeFilter);
  const libraryTagFilter = useUiStore((state) => state.libraryTagFilter);
  const libraryScope = useUiStore((state) => state.libraryScope);
  const librarySectionFilter = useUiStore((state) => state.librarySectionFilter);
  const libraryGroupBySection = useUiStore((state) => state.libraryGroupBySection);
  const toggleLibraryType = useUiStore((state) => state.toggleLibraryType);
  const toggleLibraryTag = useUiStore((state) => state.toggleLibraryTag);
  const toggleLibrarySection = useUiStore((state) => state.toggleLibrarySection);
  const clearLibraryFilters = useUiStore((state) => state.clearLibraryFilters);
  const setLibraryScope = useUiStore((state) => state.setLibraryScope);
  const toggleLibraryGroupBySection = useUiStore((state) => state.toggleLibraryGroupBySection);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const setFocus = usePresenceStore((state) => state.setFocus);
  const setBoard = usePresenceStore((state) => state.setBoard);
  const bindPresence = usePresenceStore((state) => state.bind);
  const peerCount = usePresenceStore((state) => Object.keys(state.peers).length);

  const [boardToDelete, setBoardToDelete] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const stagger = useRef(0);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (provider) bindPresence(presence, TAB_ID);
  }, [bindPresence, presence, provider]);

  // Seeding is once per workspace, so deleting every card stays deleted. It also
  // waits for the first server sync: seeding an empty local doc would resurrect
  // starter cards in a workspace someone emptied on another client.
  useEffect(() => {
    if (!ready || !synced) return;
    // Starter types are structural, not sample data: every workspace has them,
    // and the note type is the fallback for cards with no type.
    workspace.ensureDefaultTypes();
    if (!workspace.hasSeeded()) {
      const board = workspace.ensureBoard();
      // A workspace created from the launcher starts blank; older workspaces
      // keep the two-card demo they were seeded with.
      const fresh = new URLSearchParams(window.location.search).get("fresh") === "1";
      if (!fresh && workspace.listCards().length === 0) {
        workspace.createCard({ id: "starter-1", boardId: board.id, position: { x: 0, y: 0 } });
        workspace.createCard({ id: "starter-2", boardId: board.id, position: { x: 320, y: 0 } });
      }
      workspace.markSeeded();
    }
    // The reference index is derived, so repairing it is safe and idempotent. It
    // runs after the first sync so mentions that arrived offline are indexed too.
    workspace.ensureReferences();
  }, [ready, synced, workspace]);

  // Resolve the board from the URL, falling back to the first one.
  useEffect(() => {
    if (!ready || !synced) return;
    const boards = snapshot.boards;
    if (boards.length === 0) {
      workspace.ensureBoard();
      return;
    }
    if (activeBoardId && boards.some((board) => board.id === activeBoardId)) return;

    const requested = resolveBoardId();
    const next = boards.find((board) => board.id === requested)?.id ?? boards[0]?.id ?? null;
    if (next && next !== activeBoardId) setActiveBoardId(next);
  }, [ready, synced, snapshot.boards, activeBoardId, setActiveBoardId, workspace]);

  // Keep the URL shareable without a reload.
  useEffect(() => {
    if (!activeBoardId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", workspaceId);
    url.searchParams.set("board", activeBoardId);
    url.searchParams.delete("fresh");
    window.history.replaceState(null, "", url);
  }, [activeBoardId, workspaceId]);

  useEffect(() => {
    if (!activeBoardId) return;
    rememberWorkspace({
      id: workspaceId,
      title: snapshot.boards.find((board) => board.id === activeBoardId)?.name,
      boardId: activeBoardId,
    });
  }, [workspaceId, activeBoardId, snapshot.boards]);

  useEffect(() => {
    setBoard(activeBoardId);
  }, [activeBoardId, setBoard]);

  // Carets are card- and field-scoped: peers only draw them in the editor the
  // author is actually typing in.
  useEffect(() => {
    setFocus(editingNodeId ? { nodeId: editingNodeId, field: editingField } : null);
  }, [editingNodeId, editingField, setFocus]);

  const canvasPoint = useCallback(
    (clientPoint?: { x: number; y: number }) => {
      if (clientPoint) return screenToFlowPosition(clientPoint);
      const rect = document.querySelector('[data-testid="canvas-board"]')?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      return screenToFlowPosition({ x, y });
    },
    [screenToFlowPosition],
  );

  const placeCard = useCallback(
    (cardId: string, point?: { x: number; y: number }) => {
      if (!activeBoardId) return;
      if (point) {
        // Dropped cards land under the cursor rather than hanging off it.
        const dropped = canvasPoint(point);
        workspace.placeCard(activeBoardId, cardId, {
          x: dropped.x - CARD_HALF_WIDTH,
          y: dropped.y - CARD_HALF_HEIGHT,
        });
        return;
      }
      const centre = canvasPoint();
      const step = stagger.current++ % 5;
      workspace.placeCard(activeBoardId, cardId, {
        x: centre.x + step * 14 - 28,
        y: centre.y + step * 14 - 28,
      });
    },
    [activeBoardId, canvasPoint, workspace],
  );

  const createCard = useCallback(
    (typeId: string, point?: { x: number; y: number }) => {
      if (!activeBoardId) return;
      const position = point ? canvasPoint(point) : canvasPoint();
      const card = workspace.createCard({ typeId, boardId: activeBoardId, position });
      startEditing(card.id, "title");
    },
    [activeBoardId, canvasPoint, workspace, startEditing],
  );

  const activeBoardName = snapshot.boards.find((board) => board.id === activeBoardId)?.name ?? null;
  const boardSections = useMemo(
    () =>
      activeBoardId ? snapshot.sections.filter((section) => section.boardId === activeBoardId) : [],
    [snapshot.sections, activeBoardId],
  );
  const boardPlacements = useMemo(
    () =>
      activeBoardId
        ? snapshot.placements.filter((placement) => placement.boardId === activeBoardId)
        : [],
    [snapshot.placements, activeBoardId],
  );
  const boardMembership = useMemo(
    () =>
      activeBoardId ? sectionMembership(boardPlacements, boardSections) : new Map<string, string>(),
    [activeBoardId, boardPlacements, boardSections],
  );
  // The same trees the outline rail draws, so the facet and the grouping agree
  // with it about order and depth.
  const sectionOrder = useMemo(
    () =>
      outlineRows(boardSections, boardMembership).map((row) => ({
        id: row.section.id,
        title: row.section.title.trim() || "Untitled section",
        depth: row.depth,
      })),
    [boardSections, boardMembership],
  );

  /**
   * A card's section on the active board plus every ancestor, innermost first,
   * or the unsorted sentinel. Selecting a section therefore includes its subtree.
   */
  const sectionIdsByCard = useMemo(() => {
    const ids = new Map<string, string[]>();
    for (const placement of boardPlacements) {
      const match = sectionForCard(placement, boardSections);
      ids.set(
        placement.cardId,
        match
          ? sectionPath(match, boardSections)
              .map((section) => section.id)
              .reverse()
          : [UNSORTED_SECTION],
      );
    }
    return ids;
  }, [boardPlacements, boardSections]);

  const sectionIdsFor = useCallback(
    (cardId: string): string[] => sectionIdsByCard.get(cardId) ?? [UNSORTED_SECTION],
    [sectionIdsByCard],
  );

  const toItem = useCallback(
    (cardId: string): LibraryItem => {
      const card = workspace.getCard(cardId);
      return {
        id: cardId,
        title: workspace.displayTitle(cardId),
        boards: workspace.listCardPlacements(cardId).flatMap((placement) => {
          const board = workspace.getBoard(placement.boardId);
          return board ? [{ id: board.id, name: board.name }] : [];
        }),
        typeIds: card?.typeIds ?? [],
        tagIds: card?.tags ?? [],
        sectionIds: sectionIdsFor(cardId),
        properties: card?.properties ?? {},
      };
    },
    [workspace, sectionIdsFor],
  );

  const expandRow = useCallback((cardId: string | null) => {
    setExpandedRowId(cardId);
    const state = useUiStore.getState();
    if (cardId) {
      state.setPanelOwner("library");
      return;
    }
    if (state.panelOwner === "library") state.setPanelOwner(null);
  }, []);

  const cards = snapshot.cards;
  const inbox = cards.filter((card) => !card.deletedAt).map((card) => card.id);
  const unplaced = inbox.filter((id) => workspace.listCardPlacements(id).length === 0);
  const trashed = workspace.listTrashedCards().map((card) => card.id);
  const allCards = inbox.map((id) => id);

  // Facet filtering lives in the drawer: it owns the section facet, and every
  // facet needs the counts computed against the others.
  const inboxItems = unplaced.map(toItem);
  const cardItems = allCards.map(toItem);
  const trashItems = trashed.map(toItem);

  return (
    <div className="app-canvas flex h-screen w-screen flex-col" data-ready={ready && synced}>
      <TitleBar
        status={status}
        peerCount={peerCount}
        documentId={workspaceId}
        actions={
          <WorkspaceActions
            workspaceId={workspaceId}
            boardId={activeBoardId}
            title={activeBoardName ?? "Workspace"}
          />
        }
      >
        <BoardTabs
          boards={snapshot.boards}
          activeBoardId={activeBoardId}
          onSelect={setActiveBoardId}
          onCreate={() => {
            const board = workspace.createBoard();
            setActiveBoardId(board.id);
          }}
          onRename={(boardId, name) => workspace.renameBoard(boardId, name)}
          onDeleteRequest={(boardId) => {
            // Nothing to lose on an empty board, so skip the dialog.
            if (workspace.listBoardCards(boardId).length === 0) {
              workspace.deleteBoard(boardId);
              return;
            }
            setBoardToDelete(boardId);
          }}
        />
      </TitleBar>

      <main className="relative z-10 min-h-0 flex-1">
        <CanvasBoard />
        {activeBoardId && workspace.listBoardCards(activeBoardId).length === 0 ? (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4"
            data-testid="empty-board"
          >
            <div className="pointer-events-auto max-w-[320px] rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] px-5 py-4 text-center shadow-lg">
              <p className="text-[13px] font-semibold">A blank board</p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--ink-muted)]">
                Double-click anywhere, or start with a note.
              </p>
              <button
                type="button"
                className="mt-3 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-[var(--surface)] hover:opacity-90"
                onClick={() => createCard("note")}
              >
                New note
              </button>
            </div>
          </div>
        ) : null}
        <BoardOutlineHost />
        <CardInspectorHost />
      </main>

      <Dock
        inboxCount={unplaced.length}
        libraryOpen={libraryOpen}
        onToggleLibrary={() => setLibraryOpen(!libraryOpen)}
        types={snapshot.types}
        onCreateCard={(typeId) => createCard(typeId)}
        onManageTypes={openTypeSettings}
      />

      <TypeSettingsHost />

      <LibraryDrawer
        open={libraryOpen}
        tab={libraryTab}
        counts={{ inbox: unplaced.length, cards: allCards.length, trash: trashed.length }}
        inbox={inboxItems}
        cards={cardItems}
        trash={trashItems}
        onTab={setLibraryTab}
        onClose={() => setLibraryOpen(false)}
        onPlace={placeCard}
        onCreateInInbox={() => workspace.createCard()}
        onTrash={(cardId) => workspace.trashCard(cardId)}
        onRestore={(cardId) => workspace.restoreCard(cardId)}
        onDeleteForever={(cardId) => workspace.purgeCard(cardId)}
        onEmptyTrash={() => workspace.emptyTrash()}
        onGoToBoard={setActiveBoardId}
        onDropAt={(cardId, point) => placeCard(cardId, point)}
        types={snapshot.types}
        tags={snapshot.tags}
        typeFilter={libraryTypeFilter}
        tagFilter={libraryTagFilter}
        onToggleType={toggleLibraryType}
        onToggleTag={toggleLibraryTag}
        onClearFilters={clearLibraryFilters}
        activeBoardId={activeBoardId}
        activeBoardName={activeBoardName}
        scope={libraryScope}
        onScope={setLibraryScope}
        sectionFilter={librarySectionFilter}
        onToggleSection={toggleLibrarySection}
        sectionOrder={sectionOrder}
        groupBySection={libraryGroupBySection}
        onToggleGroup={toggleLibraryGroupBySection}
        expandedRowId={expandedRowId}
        onExpandRow={expandRow}
      />

      <PerfOverlay />

      {boardToDelete ? (
        <Dialog
          title="Delete board?"
          description={`${workspace.getBoard(boardToDelete)?.name ?? "This board"} has ${
            workspace.listBoardCards(boardToDelete).length
          } card(s) on it. Cards can stay in the library, or move to the trash with the board.`}
          onClose={() => setBoardToDelete(null)}
          actions={[
            {
              label: "Keep cards",
              primary: true,
              onSelect: () => {
                workspace.deleteBoard(boardToDelete, { cards: "keep" });
                setBoardToDelete(null);
              },
            },
            {
              label: "Trash cards",
              danger: true,
              onSelect: () => {
                workspace.deleteBoard(boardToDelete, { cards: "trash" });
                setBoardToDelete(null);
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
