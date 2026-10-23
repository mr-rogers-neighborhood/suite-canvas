import { sectionForCard, sectionMembership } from "@suite/graph";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { SharePublishButton } from "./components/SharePublishButton";
import { TitleBar } from "./components/TitleBar";
import { TypeSettingsHost } from "./components/TypeSettingsHost";
import { ViewsBar } from "./components/ViewsBar";
import { PerfOverlay } from "./dev/PerfOverlay";
import { countRender } from "./dev/perf";
import { WorkspaceLauncher } from "./launcher/WorkspaceLauncher";
import { isStandalone } from "./session/mode";
import { getSession, type ShareSession } from "./session/session";
import { rememberWorkspace } from "./session/workspaceTransfer";
import { resolveBoardId, useCanvasStore } from "./store/useCanvasStore";
import { useUiStore } from "./store/useUiStore";
import { useWorkspaceSnapshot } from "./store/workspaceStore";
import { initTheme } from "./theme/useThemeStore";

/** Card glyph box in flow units: `w-56` wide, tall enough for a header + one line. */
const CARD_HALF_WIDTH = 112;
const CARD_HALF_HEIGHT = 40;

/** What the app bar calls this document. A share never names its owner's workspace. */
function documentLabel(share: ShareSession, workspaceId: string): string {
  if (share.scope === "board") return "Board share";
  if (share.scope === "card") return "Card share";
  if (share.scope === "selection") return "Selection share";
  return workspaceId;
}

/**
 * The workspace actions pull in the share dialog, the recovery dialog and the
 * relay clients. Loading them on demand keeps `/api` out of the standalone
 * build's app chunk entirely, rather than relying on a runtime guard.
 */
const WorkspaceActions = lazy(async () => {
  const module = await import("./components/WorkspaceActions");
  return { default: module.WorkspaceActions };
});

export default function App() {
  useEffect(() => initTheme(), []);

  const session = getSession();
  const workspaceId = session.workspaceId;
  if (!workspaceId) return <WorkspaceLauncher />;

  return (
    <ReactFlowProvider>
      <WorkspaceShell workspaceId={workspaceId} share={session.share} />
    </ReactFlowProvider>
  );
}

function WorkspaceShell({
  workspaceId,
  share,
}: {
  workspaceId: string;
  share: ShareSession | null;
}) {
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
  const openInspector = useUiStore((state) => state.openInspector);
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
  const readOnly = useUiStore((state) => state.readOnly);
  const canCreateContent = useUiStore((state) => state.canCreateContent);
  const canCreateBoards = useUiStore((state) => state.canCreateBoards);
  const canManageBoards = useUiStore((state) => state.canManageBoards);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const canManageTrash = useUiStore((state) => state.canManageTrash);
  const setFocus = usePresenceStore((state) => state.setFocus);
  const setBoard = usePresenceStore((state) => state.setBoard);
  const bindPresence = usePresenceStore((state) => state.bind);
  const peerCount = usePresenceStore((state) => Object.keys(state.peers).length);

  // The live workspace surface — dock, library, boards and schema — belongs to
  // the owner and to a workspace editor token. Board and card shares edit one
  // projection and publish it, so they never see it.
  const workspaceSurface = !share || share.scope === "workspace";

  const [boardToDelete, setBoardToDelete] = useState<string | null>(null);
  const stagger = useRef(0);
  const shareCardOpened = useRef(false);
  // A standalone build renders from IndexedDB alone: no socket, no presence and
  // no sharing, all decided once at build time.
  const standalone = isStandalone();

  useEffect(() => {
    if (standalone) return;
    connect();
  }, [connect, standalone]);

  useEffect(() => {
    if (standalone) {
      // Nothing will sync in this build, so the relay's 5 s grace period would
      // only delay the first seed of a local workspace.
      if (!useCanvasStore.getState().synced) useCanvasStore.setState({ synced: true });
      return;
    }
    if (provider) bindPresence(presence, TAB_ID);
  }, [bindPresence, presence, provider, standalone]);

  // Seeding is once per workspace, so deleting every card stays deleted. It also
  // waits for the first server sync: seeding an empty local doc would resurrect
  // starter cards in a workspace someone emptied on another client.
  useEffect(() => {
    // A share reads a projection the owner's workspace already seeded; writing
    // in a share room (even the idempotent type repair) belongs to the draft,
    // not to this page's boot.
    if (share || readOnly || !ready || !synced) return;
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
  }, [ready, synced, workspace, readOnly, share]);

  // Resolve the board from the URL, falling back to the first one.
  useEffect(() => {
    if (!ready || !synced) return;
    const boards = snapshot.boards;
    if (boards.length === 0) {
      // A projection can arrive a moment after the room joins; wait for it
      // instead of minting a board the share may not write.
      if (!share && !readOnly) workspace.ensureBoard();
      return;
    }
    if (activeBoardId && boards.some((board) => board.id === activeBoardId)) return;

    const requested = resolveBoardId();
    const next = boards.find((board) => board.id === requested)?.id ?? boards[0]?.id ?? null;
    if (next && next !== activeBoardId) setActiveBoardId(next);
  }, [ready, synced, snapshot.boards, activeBoardId, setActiveBoardId, workspace, readOnly, share]);

  // Keep the URL shareable without a reload. A share keeps its token and never
  // gains a workspace id: the link is the whole credential.
  useEffect(() => {
    if (!activeBoardId) return;
    const url = new URL(window.location.href);
    if (share) {
      url.searchParams.set("share", share.token);
      url.searchParams.set("board", activeBoardId);
      // A share link carries no workspace id, even if it was pasted with one,
      // and never carries the owner fragment of the page it was created from.
      url.searchParams.delete("workspace");
      url.searchParams.delete("doc");
      url.searchParams.delete("fresh");
      url.hash = "";
    } else {
      url.searchParams.set("workspace", workspaceId);
      url.searchParams.set("board", activeBoardId);
      url.searchParams.delete("fresh");
    }
    window.history.replaceState(null, "", url);
  }, [activeBoardId, workspaceId, share]);

  useEffect(() => {
    // A share is a visit, not a workspace to come back to from the launcher.
    if (!activeBoardId || share) return;
    rememberWorkspace({
      id: workspaceId,
      title: snapshot.boards.find((board) => board.id === activeBoardId)?.name,
      boardId: activeBoardId,
    });
  }, [workspaceId, activeBoardId, snapshot.boards, share]);

  // A card link opens on that card. The projection may still be syncing, so wait
  // for the card to exist; once opened, closing the panel is the reader's choice.
  useEffect(() => {
    if (share?.scope !== "card" || shareCardOpened.current) return;
    if (!ready || !synced || !share.cardId) return;
    if (!snapshot.cards.some((card) => card.id === share.cardId)) return;
    shareCardOpened.current = true;
    openInspector(share.cardId);
  }, [share, ready, synced, snapshot.cards, openInspector]);

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

  const boardEmpty = !!activeBoardId && workspace.listBoardCards(activeBoardId).length === 0;
  // A projection can arrive empty when the owner's cards left the board — the
  // link still works, so the viewer gets one honest line instead of the
  // owner's creation prompt, which they cannot act on anyway.
  const sharedEmpty = boardEmpty && !!share && !canCreateContent;

  return (
    <div className="app-canvas flex h-screen w-screen flex-col" data-ready={ready && synced}>
      <TitleBar
        // A standalone build never opens a socket, so "Syncing" would be a lie;
        // the status slot reports the connection it has (none) beside the note.
        status={standalone ? "disconnected" : status}
        {...(share ? { role: share.role } : {})}
        peerCount={standalone ? 0 : peerCount}
        documentId={share ? documentLabel(share, workspaceId) : workspaceId}
        actions={
          // Share sessions only exist on a relay. The literal is inlined by Vite,
          // so a standalone build drops this branch — and the publish button and
          // `/api/shares` client behind it — instead of shipping dead relay UI.
          // A constant or `isStandalone()` call would be opaque to the bundler.
          share && import.meta.env.VITE_SUITE_MODE !== "standalone" ? (
            <SharePublishButton />
          ) : (
            <>
              <Suspense fallback={null}>
                <WorkspaceActions
                  workspaceId={workspaceId}
                  boardId={activeBoardId}
                  title={activeBoardName ?? "Workspace"}
                />
              </Suspense>
              {standalone ? (
                <span
                  data-testid="local-only"
                  title="This build keeps every workspace in this browser: no sync, no sharing."
                  className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)]"
                >
                  Local only
                </span>
              ) : null}
            </>
          )
        }
      >
        {workspaceSurface ? (
          <>
            <BoardTabs
              boards={snapshot.boards}
              activeBoardId={activeBoardId}
              onSelect={setActiveBoardId}
              canCreateBoards={canCreateBoards}
              canManageBoards={canManageBoards}
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
            <ViewsBar canManage={canManageSchema} />
          </>
        ) : null}
      </TitleBar>

      <main className="relative z-10 min-h-0 flex-1">
        <CanvasBoard />
        {workspaceSurface && canCreateContent && boardEmpty ? (
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
        {sharedEmpty ? (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4"
            data-testid="empty-board"
            data-empty-reason="shared-cards-gone"
          >
            <div className="pointer-events-auto max-w-[320px] rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] px-5 py-4 text-center shadow-lg">
              <p className="text-[12px] leading-5 text-[var(--ink-muted)]">
                Nothing to show — these shared cards were moved or deleted.
              </p>
            </div>
          </div>
        ) : null}
        <BoardOutlineHost />
        <CardInspectorHost />
      </main>

      {workspaceSurface && !readOnly ? (
        <Dock
          inboxCount={unplaced.length}
          libraryOpen={libraryOpen}
          onToggleLibrary={() => setLibraryOpen(!libraryOpen)}
          types={snapshot.types}
          onCreateCard={(typeId) => createCard(typeId)}
          onManageTypes={openTypeSettings}
          canManageSchema={canManageSchema}
        />
      ) : null}

      {workspaceSurface && canManageSchema ? <TypeSettingsHost /> : null}

      {workspaceSurface && !readOnly ? (
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
          onOpenCard={openInspector}
          canManageTrash={canManageTrash}
        />
      ) : null}

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
