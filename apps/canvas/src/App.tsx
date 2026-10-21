import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasBoard } from "./canvas/CanvasBoard";
import { TAB_ID } from "./collab/tabId";
import { usePresenceStore } from "./collab/usePresenceStore";
import { BoardTabs } from "./components/BoardTabs";
import { CardInspectorHost } from "./components/CardInspectorHost";
import { Dialog } from "./components/Dialog";
import { Dock } from "./components/Dock";
import { LibraryDrawer, type LibraryItem } from "./components/LibraryDrawer";
import { filterItems } from "./components/libraryFilters";
import { TitleBar } from "./components/TitleBar";
import { TypeSettingsHost } from "./components/TypeSettingsHost";
import { PerfOverlay } from "./dev/PerfOverlay";
import { countRender } from "./dev/perf";
import { resolveBoardId, useCanvasStore, WORKSPACE_ID } from "./store/useCanvasStore";
import { useUiStore } from "./store/useUiStore";
import { useWorkspaceSnapshot } from "./store/workspaceStore";
import { initTheme } from "./theme/useThemeStore";

/** Card glyph box in flow units: `w-56` wide, tall enough for a header + one line. */
const CARD_HALF_WIDTH = 112;
const CARD_HALF_HEIGHT = 40;

export default function App() {
  useEffect(() => initTheme(), []);

  return (
    <ReactFlowProvider>
      <WorkspaceShell />
    </ReactFlowProvider>
  );
}

function WorkspaceShell() {
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
  const toggleLibraryType = useUiStore((state) => state.toggleLibraryType);
  const toggleLibraryTag = useUiStore((state) => state.toggleLibraryTag);
  const clearLibraryFilters = useUiStore((state) => state.clearLibraryFilters);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const setFocus = usePresenceStore((state) => state.setFocus);
  const setBoard = usePresenceStore((state) => state.setBoard);
  const bindPresence = usePresenceStore((state) => state.bind);
  const peerCount = usePresenceStore((state) => Object.keys(state.peers).length);

  const [boardToDelete, setBoardToDelete] = useState<string | null>(null);
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
    if (workspace.hasSeeded()) return;
    const board = workspace.ensureBoard();
    if (workspace.listCards().length === 0) {
      workspace.createCard({ id: "starter-1", boardId: board.id, position: { x: 0, y: 0 } });
      workspace.createCard({ id: "starter-2", boardId: board.id, position: { x: 320, y: 0 } });
    }
    workspace.markSeeded();
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
    url.searchParams.set("workspace", WORKSPACE_ID);
    url.searchParams.set("board", activeBoardId);
    window.history.replaceState(null, "", url);
  }, [activeBoardId]);

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

  const toItem = useCallback(
    (cardId: string): LibraryItem => ({
      id: cardId,
      title: workspace.displayTitle(cardId),
      boards: workspace.listCardPlacements(cardId).flatMap((placement) => {
        const board = workspace.getBoard(placement.boardId);
        return board ? [{ id: board.id, name: board.name }] : [];
      }),
      typeIds: workspace.getCard(cardId)?.typeIds ?? [],
      tagIds: workspace.getCard(cardId)?.tags ?? [],
    }),
    [workspace],
  );

  const cards = snapshot.cards;
  const inbox = cards.filter((card) => !card.deletedAt).map((card) => card.id);
  const unplaced = inbox.filter((id) => workspace.listCardPlacements(id).length === 0);
  const trashed = workspace.listTrashedCards().map((card) => card.id);
  const allCards = inbox.map((id) => id);

  const filteredInbox = filterItems(unplaced.map(toItem), libraryTypeFilter, libraryTagFilter);
  const filteredCards = filterItems(allCards.map(toItem), libraryTypeFilter, libraryTagFilter);
  const filteredTrash = filterItems(trashed.map(toItem), libraryTypeFilter, libraryTagFilter);

  return (
    <div className="app-canvas flex h-screen w-screen flex-col" data-ready={ready && synced}>
      <TitleBar status={status} peerCount={peerCount} documentId={WORKSPACE_ID}>
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
        inbox={filteredInbox}
        cards={filteredCards}
        trash={filteredTrash}
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
