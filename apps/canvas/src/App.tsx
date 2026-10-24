import { sectionForCard, sectionMembership } from "@suite/graph";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boardRows } from "./canvas/boardRows";
import { DEFAULT_BOARD_SIZE } from "./canvas/boardSize";
import { prefersReducedMotion } from "./canvas/localEasing";
import { DEFAULT_CARD_WIDTH } from "./canvas/multiSelect";
import { TAB_ID } from "./collab/tabId";
import { usePresenceStore } from "./collab/usePresenceStore";
import { BootSkeleton } from "./components/BootSkeleton";
import { CardFocusHost } from "./components/CardFocusHost";
import { CardInspectorHost } from "./components/CardInspectorHost";
import { sectionPath } from "./components/cardWhere";
import { Dialog } from "./components/Dialog";
import { Dock } from "./components/Dock";
import { LibraryDrawer, type LibraryItem } from "./components/LibraryDrawer";
import { UNSORTED_SECTION } from "./components/libraryFilters";
import { SharePublishButton } from "./components/SharePublishButton";
import { StoragePanel } from "./components/StoragePanel";
import { TitleBar } from "./components/TitleBar";
import { TypeSettingsHost } from "./components/TypeSettingsHost";
import { ViewsBar } from "./components/ViewsBar";
import { type ViewPresence, ViewTabs } from "./components/ViewTabs";
import { seedExampleWorkspace, seedModeFor } from "./demo/seedExample";
import { markBoot, measureBoot } from "./dev/bootTiming";
import { PerfOverlay } from "./dev/PerfOverlay";
import { countRender } from "./dev/perf";
import { useBootGate } from "./hooks/useBootGate";
import { screenToWorld } from "./ice/iceScreenToWorld";
import { WorkspaceLauncher } from "./launcher/WorkspaceLauncher";
import { isStandalone } from "./session/mode";
import { getSession, type ShareSession } from "./session/session";
import {
  friendlyWorkspaceName,
  readWorkspaceNames,
  rememberWorkspaceName,
} from "./session/workspaceName";
import { rememberWorkspace } from "./session/workspaceTransfer";
import { resolveBoardId, useCanvasStore } from "./store/useCanvasStore";
import { useUiStore } from "./store/useUiStore";
import { useWorkspaceSnapshot } from "./store/workspaceStore";
import { initTheme } from "./theme/useThemeStore";

/** Half of the default card box (`w-72`), so a dropped card lands under the pointer. */
const CARD_HALF_WIDTH = 144;
const CARD_HALF_HEIGHT = 60;

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
const IceSurface = lazy(() => import("./ice/IceSurface"));

const WorkspaceActions = lazy(async () => {
  const module = await import("./components/WorkspaceActions");
  return { default: module.WorkspaceActions };
});

export default function App() {
  useEffect(() => initTheme(), []);

  const session = getSession();
  const workspaceId = session.workspaceId;
  if (!workspaceId) return <WorkspaceLauncher />;

  return <WorkspaceShell workspaceId={workspaceId} share={session.share} />;
}

function WorkspaceShell({
  workspaceId,
  share,
}: {
  workspaceId: string;
  share: ShareSession | null;
}) {
  const workspace = useCanvasStore((state) => state.workspace);
  const [workspaceName, setWorkspaceName] = useState(() => workspace.workspaceName());
  const connect = useCanvasStore((state) => state.connect);
  const provider = useCanvasStore((state) => state.provider);
  const presence = useCanvasStore((state) => state.presence);
  const status = useCanvasStore((state) => state.status);
  const ready = useCanvasStore((state) => state.ready);
  const synced = useCanvasStore((state) => state.synced);
  const boot = useBootGate(ready);
  const [leaving, setLeaving] = useState(false);
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
  const cardFocusId = useUiStore((state) => state.cardFocusId);
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
  // One dot per board with company. The store's peer map is replaced only when
  // presence changes, so this memo is stable between pointer ticks; `useShallow`
  // is not enough because each board's label/colour pair is a new object.
  const peers = usePresenceStore((state) => state.peers);
  const peersByView = useMemo(() => {
    const names = new Map<string, Set<string>>();
    const colors = new Map<string, string>();
    for (const peer of Object.values(peers)) {
      if (!peer.board) continue;
      const set = names.get(peer.board) ?? new Set<string>();
      set.add(peer.user.name);
      names.set(peer.board, set);
      if (!colors.has(peer.board)) colors.set(peer.board, peer.user.color);
    }
    const map: Record<string, ViewPresence> = {};
    for (const [boardId, set] of names) {
      map[boardId] = {
        label: [...set].sort().join(", "),
        color: colors.get(boardId) ?? "var(--section-violet)",
      };
    }
    return map;
  }, [peers]);
  const activateBoard = useUiStore((state) => state.activateBoard);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);

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
      // A direct URL can create the first document without the launcher, so
      // the friendly default is applied here too; an existing name always wins.
      if (!workspace.hasWorkspaceName()) {
        workspace.renameWorkspace(friendlyWorkspaceName());
        setWorkspaceName(workspace.workspaceName());
      }
      const seedMode = seedModeFor(window.location.search);
      if (seedMode === "blank") {
        workspace.ensureView();
      } else if (seedMode === "example") {
        seedExampleWorkspace(workspace);
      } else {
        const board = workspace.ensureView();
        if (workspace.listCards().length === 0) {
          workspace.createCard({ id: "starter-1", boardId: board.id, position: { x: 0, y: 0 } });
          // One card width plus a gap, so the two starters read as two cards and a
          // section drawn around the first does not reach into the second.
          workspace.createCard({
            id: "starter-2",
            boardId: board.id,
            position: { x: DEFAULT_CARD_WIDTH + 192, y: 0 },
          });
        }
      }
      workspace.markSeeded();
    }
    // The reference index is derived, so repairing it is safe and idempotent. It
    // runs after the first sync so mentions that arrived offline are indexed too.
    workspace.ensureReferences();
  }, [ready, synced, workspace, readOnly, share]);

  useEffect(() => {
    document.title = `${workspaceName} — Suite`;
  }, [workspaceName]);

  const goHome = useCallback(() => {
    if (leaving) return;
    if (prefersReducedMotion()) {
      window.location.assign("/");
      return;
    }
    setLeaving(true);
    window.setTimeout(() => window.location.assign("/"), 180);
  }, [leaving]);

  useEffect(() => {
    if (!ready) return;
    markBoot("shell:ready");
    measureBoot("to-ready", "store:created", "shell:ready");
  }, [ready]);

  // The launcher may have named this workspace before its document existed.
  // Adopt that mirror once, and only when the document has no name of its own.
  useEffect(() => {
    if (!ready || !synced || share || readOnly || workspace.hasWorkspaceName()) return;
    const mirror = readWorkspaceNames()[workspaceId]?.trim();
    if (!mirror) return;
    try {
      workspace.renameWorkspace(mirror);
      setWorkspaceName(workspace.workspaceName());
    } catch {
      // A name that no longer validates stays in the mirror; the document keeps
      // its derived label rather than failing the boot.
    }
  }, [ready, synced, share, readOnly, workspace, workspaceId]);

  // Resolve the view from the URL, falling back to the first one. A View is a
  // camera (ADR-0039), so this is which place the reader is standing in, not
  // what the document holds.
  useEffect(() => {
    if (!ready || !synced) return;
    const views = snapshot.views;
    if (views.length === 0) {
      // A projection can arrive a moment after the room joins; wait for it
      // instead of minting a view the share may not write.
      if (!share && !readOnly) workspace.ensureView();
      return;
    }
    if (activeBoardId && views.some((view) => view.id === activeBoardId)) return;

    const requested = resolveBoardId();
    const next = views.find((view) => view.id === requested)?.id ?? views[0]?.id ?? null;
    if (next && next !== activeBoardId) setActiveBoardId(next);
  }, [ready, synced, snapshot.views, activeBoardId, setActiveBoardId, workspace, readOnly, share]);

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
      title: snapshot.views.find((view) => view.id === activeBoardId)?.name,
      boardId: activeBoardId,
    });
  }, [workspaceId, activeBoardId, snapshot.views, share]);

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

  /**
   * A point in the document, from a client point. Two steps, both owned
   * elsewhere: the client point becomes a point in the surface's own box, and
   * the surface's camera (published by ICE) inverts screen → document. Skipping
   * the second step put every dropped card at its screen position, which is only
   * right when the camera happens to sit at the origin at 1:1.
   */
  const canvasPoint = useCallback((clientPoint?: { x: number; y: number }) => {
    const rect = document.querySelector('[data-testid="ice-surface"]')?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const width = rect?.width ?? window.innerWidth;
    const height = rect?.height ?? window.innerHeight;
    const onSurface = clientPoint
      ? { x: clientPoint.x - left, y: clientPoint.y - top }
      : { x: width / 2, y: height / 2 };
    return screenToWorld(onSurface);
  }, []);

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

  /**
   * Plants an empty Board on the plane the reader is standing on: one commit,
   * no card behind it (ADR-0039). The frame lands centred on the surface.
   */
  const createBoardHere = useCallback(() => {
    if (!activeBoardId || !canCreateContent || !canCreateBoards) return;
    const centre = canvasPoint();
    const board = workspace.createBoard({
      name: `Board ${workspace.listBoardChildren(activeBoardId).length + 1}`,
      parentBoardId: activeBoardId,
      x: centre.x - DEFAULT_BOARD_SIZE.width / 2,
      y: centre.y - DEFAULT_BOARD_SIZE.height / 2,
      width: DEFAULT_BOARD_SIZE.width,
      height: DEFAULT_BOARD_SIZE.height,
      color: "slate",
    });
    useUiStore.getState().selectSection(board.id);
    setSelectedNodeIds([]);
  }, [
    activeBoardId,
    canvasPoint,
    workspace,
    canCreateContent,
    canCreateBoards,
    setSelectedNodeIds,
  ]);

  const activeBoardName = snapshot.views.find((view) => view.id === activeBoardId)?.name ?? null;
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
  // Section trees in reading order, so the facet and the grouping agree about
  // order and depth.
  const sectionOrder = useMemo(
    () =>
      boardRows(boardSections, boardMembership).map((row) => ({
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
        // `placement.boardId` names the owning Board, or the View whose
        // implicit root plane owns the card (ADR-0039).
        boards: workspace.listCardPlacements(cardId).flatMap((placement) => {
          const holder =
            workspace.getBoard(placement.boardId) ?? workspace.getView(placement.boardId);
          return holder ? [{ id: holder.id, name: holder.name }] : [];
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

  // Local hydration is the only thing the first paint waits for. Remote sync
  // continues underneath; the skeleton must never become a server spinner.
  if (boot.show) return <BootSkeleton exiting={boot.exiting} />;

  return (
    <div
      className="app-canvas flex h-screen w-screen flex-col"
      data-ready={ready && synced}
      data-leaving={leaving ? "true" : undefined}
    >
      <TitleBar
        onNavigateHome={goHome}
        // A standalone build never opens a socket, so "Syncing" would be a lie;
        // the status slot reports the connection it has (none) beside the note.
        status={standalone ? "disconnected" : status}
        {...(share ? { role: share.role } : {})}
        peerCount={standalone ? 0 : peerCount}
        workspaceName={share ? documentLabel(share, workspaceId) : workspaceName}
        canRenameWorkspace={!share && !readOnly}
        onRenameWorkspace={(name) => {
          try {
            workspace.renameWorkspace(name);
            rememberWorkspaceName(workspaceId, workspace.workspaceName());
            setWorkspaceName(workspace.workspaceName());
            return null;
          } catch (cause) {
            return cause instanceof Error ? cause.message : "Could not rename the workspace.";
          }
        }}
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
              <StoragePanel workspaceId={workspaceId} />
            </>
          )
        }
      >
        {workspaceSurface ? (
          <>
            <div className="views-bar">
              <ViewsBar canManage={canManageSchema} />
            </div>
            <ViewTabs
              views={snapshot.views}
              activeViewId={activeBoardId}
              onSelect={activateBoard}
              peersByView={peersByView}
              canCreateViews={canCreateBoards}
              canManageViews={canManageBoards}
              onCreate={() => {
                const view = workspace.createView();
                activateBoard(view.id);
              }}
              onRename={(viewId, name) => workspace.renameView(viewId, name)}
              onDeleteRequest={(viewId) => {
                // Nothing to lose on an empty view, so skip the dialog.
                if (workspace.listBoardCards(viewId).length === 0) {
                  workspace.deleteView(viewId);
                  return;
                }
                setBoardToDelete(viewId);
              }}
            />
          </>
        ) : null}
      </TitleBar>

      <main className="relative z-10 min-h-0 flex-1">
        <Suspense fallback={null}>
          <IceSurface workspace={ready && synced ? workspace : null} rootBoardId={activeBoardId} />
        </Suspense>
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
        <CardInspectorHost />
        <CardFocusHost />
      </main>

      {workspaceSurface && !readOnly && !cardFocusId ? (
        <Dock
          inboxCount={unplaced.length}
          libraryOpen={libraryOpen}
          onToggleLibrary={() => setLibraryOpen(!libraryOpen)}
          types={snapshot.types}
          onCreateCard={(typeId) => createCard(typeId)}
          onCreateBoard={createBoardHere}
          onManageTypes={openTypeSettings}
          canManageSchema={canManageSchema}
          canCreateContent={canCreateContent}
          canCreateBoards={canCreateBoards}
        />
      ) : null}

      {workspaceSurface && canManageSchema ? <TypeSettingsHost /> : null}

      {workspaceSurface && !readOnly ? (
        <LibraryDrawer
          open={libraryOpen}
          tab={libraryTab}
          counts={{
            inbox: unplaced.length,
            cards: allCards.length,
            pins: workspace.listPins(activeBoardId ?? undefined).length,
            trash: trashed.length,
          }}
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
          onGoToBoard={activateBoard}
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
          title="Delete view?"
          description={`${workspace.getView(boardToDelete)?.name ?? "This view"} has ${
            workspace.listBoardCards(boardToDelete).length
          } card(s) on its plane. Cards can stay in the library, or move to the trash with the view.`}
          onClose={() => setBoardToDelete(null)}
          actions={[
            {
              label: "Keep cards",
              primary: true,
              onSelect: () => {
                workspace.deleteView(boardToDelete, { cards: "keep" });
                setBoardToDelete(null);
              },
            },
            {
              label: "Trash cards",
              danger: true,
              onSelect: () => {
                workspace.deleteView(boardToDelete, { cards: "trash" });
                setBoardToDelete(null);
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
