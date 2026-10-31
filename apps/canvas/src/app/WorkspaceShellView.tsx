import type { PaletteSwatch, WorkspaceDocument, WorkspaceMediaItem } from "@suite/graph";
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from "react";
import { lazy, Suspense, useMemo, useState } from "react";
import { SignInEntry } from "../auth/SignInEntry";
import type { AccountPhase } from "../auth/useAccountStore";
import { BoardOutlineHost } from "../canvas/BoardOutline";
import { CanvasBoard } from "../canvas/CanvasBoard";
import type { SurfacePalette } from "../canvas/rules";
import { SurfacePaintProvider } from "../canvas/surfaceContext";
import { CardFocusHost } from "../cards/CardFocusHost";
import { CardInspectorHost } from "../cards/CardInspectorHost";
import { createMediaCard } from "../cards/mediaCard";
import { TourOverlayHost } from "../cards/TourOverlayHost";
import { TypeMenuHost } from "../cards/TypeMenuHost";
import { BoardGlyph } from "../chrome/BoardGlyph";
import type { BoardPresence } from "../chrome/BoardSwitcher";
import { BoardSwitcher } from "../chrome/BoardSwitcher";
import { Dock } from "../chrome/Dock";
import { InteractionModeToggle } from "../chrome/InteractionModeToggle";
import { StartPage } from "../chrome/StartPage";
import { TitleBar } from "../chrome/TitleBar";
import { UndoRedo } from "../chrome/UndoRedo";
import { ViewsBar } from "../chrome/ViewsBar";
import { CommandPaletteHost } from "../command/CommandPalette";
import type { PaletteItem } from "../command/paletteRank";
import { PerfOverlay } from "../dev/PerfOverlay";
import { purgeAttachment } from "../editor/attachmentNode";
import { MediaPickerHost } from "../editor/MediaPickerHost";
import { FeedbackHost } from "../feedback/FeedbackHost";
import { SendFeedbackBubble } from "../feedback/SendFeedbackBubble";
import type { SyncClaim, SyncRefusal } from "../feedback/syncState";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { LibraryDrawer, type LibraryItem } from "../library/LibraryDrawer";
import { BOARD_TYPE_FACET } from "../library/libraryTypes";
import { BOARD_STARTERS } from "../library/TemplateGallery";
import { TypeSettingsHost } from "../panels/TypeSettingsHost";
import { pinnedOrder, useBoardPins } from "../session/boardPins";
import type { ShareSession } from "../session/session";
import {
  readWorkspaceNames,
  rememberWorkspaceName,
  resolveWorkspaceName,
} from "../session/workspaceName";
import { pinnedWorkspaceOrder, useWorkspacePins } from "../session/workspacePins";
import { readRecentWorkspaces, workspaceUrl } from "../session/workspaceTransfer";
import { SharePublishButton } from "../sharing/SharePublishButton";
import { StoragePanel } from "../sharing/StoragePanel";
import { LoadingPlaceholder } from "../shell/LoadingPlaceholder";
import type { useCanvasStore } from "../store/useCanvasStore";
import { type LibraryTab, useUiStore } from "../store/useUiStore";
import { AppearanceHost } from "./AppearanceHost";
import { BlueprintInstallHost } from "./BlueprintInstallHost";
import { HistoryPanelHost } from "./HistoryPanelHost";
import { NoticeStrip } from "./NoticeStrip";
import { WornRoleStrip } from "./WornRoleStrip";
import { documentLabel } from "./workspacePaint";

type UiState = ReturnType<typeof useUiStore.getState>;
type CanvasState = ReturnType<typeof useCanvasStore.getState>;

/**
 * The workspace actions pull in the share dialog, the recovery dialog and the
 * relay clients. Loading them on demand keeps `/api` out of the standalone
 * build's app chunk entirely, rather than relying on a runtime guard.
 */
const ShareAction = lazy(async () => {
  const module = await import("../chrome/ShareAction");
  return { default: module.ShareAction };
});

const WorkspaceActions = lazy(async () => {
  const module = await import("../chrome/WorkspaceActions");
  return { default: module.WorkspaceActions };
});

/**
 * The account surfaces pull in the Better Auth client. Loaded on demand for the
 * same reason as the share dialogs: a standalone build has no server and must
 * not ship a single byte of `/api/auth`, so the gate is a literal the bundler
 * folds.
 */
const SignInSurface = lazy(async () => {
  const module = await import("../auth/SignInDialogHost");
  return { default: module.SignInDialogHost };
});

export interface WorkspaceShellViewProps {
  shellRef: RefObject<HTMLDivElement | null>;
  boardRef: RefObject<HTMLElement | null>;
  ready: boolean;
  synced: boolean;
  leaving: boolean;
  /** The workspace palette and the live role colours, for every surface painter. */
  palette: readonly PaletteSwatch[];
  roles: SurfacePalette;
  mode: "light" | "dark";
  /** Leaves for the launcher, or for another workspace's URL. */
  requestLeave: (destination?: string) => void;
  setPaletteOpen: UiState["setPaletteOpen"];
  standalone: boolean;
  status: CanvasState["status"];
  share: ShareSession | null;
  peerCount: number;
  workspaceId: string;
  workspace: WorkspaceDocument;
  workspaceName: string;
  setWorkspaceName: Dispatch<SetStateAction<string>>;
  /** Who is behind this browser, as the account store knows it. */
  phase: AccountPhase;
  /** What the account says about this workspace, when it has been asked. */
  claim?: SyncClaim;
  /** Why the relay refused, when it said. */
  reason?: SyncRefusal | null;
  /** Opens the plan surface from a workspace the plan does not cover. */
  onSeePlans?: (() => void) | undefined;
  /** Asks the control plane about this workspace again, after a payment or a fix. */
  onReclaim?: (() => void) | undefined;
  inRoom: boolean;
  openSignIn: () => void;
  readOnly: boolean;
  activeBoardId: string | null;
  activeBoardName: string | null;
  canManageSchema: boolean;
  workspaceSurface: boolean;
  canEditLayout: boolean;
  canCreateContent: boolean;
  canCreateBoards: boolean;
  canManageBoards: boolean;
  canManageTrash: boolean;
  setLibraryOpen: UiState["setLibraryOpen"];
  libraryOpen: boolean;
  historyOpen: boolean;
  toggleHistory: () => void;
  outlineOpen: boolean;
  toggleOutline: () => void;
  libraryTab: LibraryTab;
  snapshot: WorkspaceSnapshot;
  /** Boards this session has been on, most recent first: the switcher's order. */
  boardRecency: string[];
  /** A placeholder tab is open: no board, the start page in its place. */
  newTab: boolean;
  openNewTab: () => void;
  boardHistory: UiState["boardHistory"];
  goBackBoard: UiState["goBackBoard"];
  peersByBoard: Record<string, BoardPresence>;
  activateBoard: UiState["activateBoard"];
  boardPainted: boolean;
  boardPaint: Record<string, string>;
  boardEmpty: boolean;
  sharedEmpty: boolean;
  createCard: (typeId: string, point?: { x: number; y: number }) => string | undefined;
  /** A new board, opened: what the start page and the tab chooser both mean. */
  createBoard: () => void;
  /** Places a portal to the board; a point drops it under the cursor. */
  createPortal: (targetBoardId: string, point?: { x: number; y: number }) => void;
  createSketch: () => void;
  createSection: () => void;
  createBoardPortal: () => void;
  openTypeSettings: UiState["openTypeSettings"];
  paletteItems: PaletteItem[];
  unplaced: string[];
  trashed: string[];
  allCards: string[];
  trashItems: LibraryItem[];
  cardFocusId: string | null;
  inboxItems: LibraryItem[];
  cardItems: LibraryItem[];
  mediaItems?: WorkspaceMediaItem[];
  trashedMediaItems?: WorkspaceMediaItem[];
  /** Boards as library rows: the same list as cards, typed `board`. */
  boardEntries: LibraryItem[];
  unplaceBoardCards: (boardId: string) => void;
  deleteBoard: (boardId: string, cards: "keep" | "trash") => void;
  locateCard: (cardId: string) => boolean;
  locateBoard: (boardId: string) => boolean;
  useBoardTemplate: (templateId: string) => void;
  useStarter: (starterId: string) => void;
  setBoardTemplate: (boardId: string, template: boolean) => void;
  setLibraryTab: UiState["setLibraryTab"];
  placeCard: (cardId: string, point?: { x: number; y: number }) => void;
  /** Put picked rows in the reader's hand, one press per card. */
  startPlaceStack: (cardIds: readonly string[]) => void;
  /** Place a whole picked set at a drop point, as a stepped stack. */
  onDropSelection: (cardIds: readonly string[], point: { x: number; y: number }) => void;
  toggleLibraryType: UiState["toggleLibraryType"];
  toggleLibraryTag: UiState["toggleLibraryTag"];
  clearLibraryFilters: UiState["clearLibraryFilters"];
  libraryTypeFilter: string[];
  libraryTagFilter: string[];
  libraryScope: UiState["libraryScope"];
  setLibraryScope: UiState["setLibraryScope"];
  libraryFull: boolean;
  setLibraryFull: UiState["setLibraryFull"];
  librarySectionFilter: string[];
  toggleLibrarySection: UiState["toggleLibrarySection"];
  sectionOrder: { id: string; title: string; depth: number }[];
  libraryGroupBySection: boolean;
  toggleLibraryGroupBySection: UiState["toggleLibraryGroupBySection"];
  openInspector: UiState["openInspector"];
}

export function WorkspaceShellView({
  shellRef,
  boardRef,
  ready,
  synced,
  leaving,
  palette,
  roles,
  mode,
  requestLeave,
  setPaletteOpen,
  standalone,
  status,
  share,
  peerCount,
  workspaceId,
  workspace,
  workspaceName,
  setWorkspaceName,
  phase,
  claim,
  reason,
  onSeePlans,
  onReclaim,
  inRoom,
  openSignIn,
  readOnly,
  activeBoardId,
  activeBoardName,
  canManageSchema,
  workspaceSurface,
  canEditLayout,
  canCreateContent,
  canCreateBoards,
  canManageBoards,
  canManageTrash,
  setLibraryOpen,
  libraryOpen,
  historyOpen,
  toggleHistory,
  outlineOpen,
  toggleOutline,
  libraryTab,
  snapshot,
  boardRecency,
  newTab,
  openNewTab,
  boardHistory,
  goBackBoard,
  peersByBoard,
  activateBoard,
  boardPainted,
  boardPaint,
  boardEmpty,
  sharedEmpty,
  createCard,
  createBoard,
  createPortal,
  createSketch,
  createSection,
  createBoardPortal,
  openTypeSettings,
  paletteItems,
  unplaced,
  trashed,
  allCards,
  trashItems,
  cardFocusId,
  inboxItems,
  cardItems,
  mediaItems = [],
  trashedMediaItems = [],
  boardEntries,
  unplaceBoardCards,
  deleteBoard,
  locateCard,
  locateBoard,
  useBoardTemplate,
  useStarter,
  setBoardTemplate,
  setLibraryTab,
  placeCard,
  startPlaceStack,
  onDropSelection,
  toggleLibraryType,
  toggleLibraryTag,
  clearLibraryFilters,
  libraryTypeFilter,
  libraryTagFilter,
  libraryScope,
  setLibraryScope,
  libraryFull,
  setLibraryFull,
  librarySectionFilter,
  toggleLibrarySection,
  sectionOrder,
  libraryGroupBySection,
  toggleLibraryGroupBySection,
  openInspector,
}: WorkspaceShellViewProps) {
  const pins = useBoardPins();
  const workspacePins = useWorkspacePins();
  /**
   * A right-click on a pinned tab, forwarded to the switcher.
   *
   * The tabs live in the bar and the menu lives in the switcher, which is what keeps one
   * implementation of rename, icon, colour and pin whichever of the two the reader used.
   * A fresh object per request is what tells the switcher "open it again".
   */
  const [rowMenuRequest, setRowMenuRequest] = useState<{
    boardId: string;
    x: number;
    y: number;
  } | null>(null);
  // Read from the document rather than the projection. A board created through
  // the portal flow reached the document (the portal rendered it) but never
  // reached `snapshot.boards`, so the switcher offered one board and the other
  // was unreachable. Every render here follows a document change, so reading the
  // document cannot be out of date.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the trigger; the list is read back from the document it was derived from.
  const boards = useMemo(() => workspace.listBoards(), [workspace, snapshot]);
  // Only a pin earns a tab: an unpinned board is one click away in the switcher,
  // and a bar that grows with every board is the strip we just removed.
  const pinnedBoards = useMemo(() => pinnedOrder(boards, pins.pinned), [boards, pins.pinned]);
  // The launcher's recents, minus this workspace: the title menu is the second
  // half of "where can I go", and it should not offer where you already are.
  const otherWorkspaces = useMemo(() => {
    // The recents mirror stores whatever title it was given, and that title has
    // been a board's name since the launcher fell back to one. Only a name the
    // document holds is a workspace name; everything else is Untitled.
    const names = readWorkspaceNames();
    const entries = pinnedWorkspaceOrder(readRecentWorkspaces(), workspacePins.pinned).filter(
      (entry) => entry.id !== workspaceId,
    );
    return entries.slice(0, 5).map((entry) => ({
      id: entry.id,
      // `resolveWorkspaceName` takes the mirror's title as a last resort, so pass
      // nothing else: a stored board name must never become a workspace label.
      title: resolveWorkspaceName(names[entry.id], undefined),
    }));
  }, [workspaceId, workspacePins.pinned]);
  // A workspace with no board at all: nothing to open, nothing to switch to. The
  // start page is the only surface here that still makes sense.
  const startPage =
    workspaceSurface && activeBoardId === null && (newTab || snapshot.boards.length === 0);
  // The start page says how much is on each board; the projection already has
  // every placement, so this is a count and nothing else.
  const boardCardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const placement of snapshot.placements) {
      counts[placement.boardId] = (counts[placement.boardId] ?? 0) + 1;
    }
    return counts;
  }, [snapshot.placements]);

  return (
    <SurfacePaintProvider.Provider value={{ palette, roles, mode }}>
      <div
        ref={shellRef}
        className="app-canvas flex h-screen w-screen flex-col"
        data-ready={ready && synced}
        data-leaving={leaving ? "true" : undefined}
      >
        <NoticeStrip />
        <WornRoleStrip />
        <TitleBar
          onNavigateHome={requestLeave}
          onOpenSearch={() => setPaletteOpen(true)}
          // A standalone build never opens a socket, so "Syncing" would be a lie;
          // the status slot reports the connection it has (none) beside the note.
          status={standalone ? "disconnected" : status}
          {...(share ? { role: share.role } : {})}
          peerCount={standalone ? 0 : peerCount}
          phase={phase}
          {...(claim === undefined ? {} : { claim })}
          reason={reason ?? null}
          workspaceId={workspaceId}
          onSignIn={openSignIn}
          {...(onSeePlans === undefined ? {} : { onSeePlans })}
          {...(onReclaim === undefined ? {} : { onReclaim })}
          // Everything about *this* device's copy lives under the same control that
          // says who else is here (ADR-0064 amendment): one status, one press.
          storage={
            <StoragePanel
              workspaceId={workspaceId}
              signedIn={phase === "signed-in"}
              synced={inRoom}
              onSignIn={openSignIn}
            />
          }
          workspaceName={share ? documentLabel(share, workspaceId) : workspaceName}
          workspacePinned={workspacePins.isPinned(workspaceId)}
          onToggleWorkspacePin={workspacePins.togglePin}
          otherWorkspaces={otherWorkspaces}
          onOpenWorkspace={(id) => requestLeave(workspaceUrl(id, null))}
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
                <Suspense
                  fallback={
                    <LoadingPlaceholder variant="inline" label="Loading workspace actions" />
                  }
                >
                  <ShareAction
                    workspaceId={workspaceId}
                    boardId={activeBoardId}
                    title={activeBoardName ?? "Workspace"}
                  />
                  <WorkspaceActions
                    workspaceId={workspaceId}
                    title={activeBoardName ?? "Workspace"}
                    onLeave={requestLeave}
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
                {/* A standalone build has no server, so it has no accounts to offer. */}
                {standalone ? null : <SignInEntry />}
              </>
            )
          }
        >
          {/*
            The board you are on is a fact about the page, not about the workspace, so
            it is shown everywhere — including a share that hands over a single board,
            where the switcher becomes a label because there is nowhere to go.
          */}
          {workspaceSurface || activeBoardId !== null ? (
            <>
              {/*
                A way back exists only where the reader was *taken* somewhere: a
                portal entry. Every other board is one click away in the
                switcher, so a permanent Back would be a second, single-direction
                navigation system. `shrink-0` on the button and a truncating
                switcher are what keep it from being clipped by its neighbour —
                the failure the old bar had.
              */}
              {activeBoardId && boardHistory.at(-1)?.via === "portal" ? (
                <button
                  type="button"
                  data-testid="portal-back"
                  aria-label={`Back to ${
                    snapshot.boards.find((board) => board.id === boardHistory.at(-1)?.boardId)
                      ?.name ?? "the previous board"
                  }`}
                  title={`Back to ${
                    snapshot.boards.find((board) => board.id === boardHistory.at(-1)?.boardId)
                      ?.name ?? "the previous board"
                  }`}
                  className="portal-back"
                  onClick={() => goBackBoard()}
                >
                  <span aria-hidden="true">{"\u2039"}</span>
                </button>
              ) : null}
              <BoardSwitcher
                boards={boards}
                activeBoardId={activeBoardId}
                recency={boardRecency}
                pinned={pins.pinned}
                onSelect={activateBoard}
                peersByBoard={peersByBoard}
                canManage={canManageBoards}
                navigation={workspaceSurface ? "workspace" : "board"}
                onCreate={createBoard}
                rowMenuRequest={rowMenuRequest}
                onOpenLibrary={(facet) => {
                  // "All boards…" is a question about boards, so it is answered with
                  // boards — the other entry points leave whatever the reader filtered
                  // to alone.
                  if (facet === "board") {
                    clearLibraryFilters();
                    toggleLibraryType(BOARD_TYPE_FACET);
                  }
                  setLibraryTab("cards");
                  setLibraryOpen(true);
                }}
                onRename={(boardId, name) => workspace.renameBoard(boardId, name)}
                onSetColor={(boardId, color) => workspace.setBoardColor(boardId, color)}
                onSetIcon={(boardId, icon) => workspace.setBoardIcon(boardId, icon)}
                onTogglePin={pins.togglePin}
              />
              {/*
                Saved views are unfinished, so they are a development-only door.
                The component is complete enough to drive and its specs run against
                the dev server, but the surface around it is not: a reader who is
                handed "Save view" today gets a control with no way back to what it
                filtered, and an alpha is the wrong place to explain that.

                `import.meta.env.DEV` is a literal Vite inlines, so a production
                bundle drops this branch and the component with it. Removing the
                guard is the whole change when the feature is ready, and
                `docs/reference/ui.md` says so — an unmounted component with green
                unit tests is how the bar went missing for a day (5f0a6da6).
              */}
              {workspaceSurface && import.meta.env.DEV ? (
                <ViewsBar canManage={canManageSchema} />
              ) : null}
              {pinnedBoards.length === 0 ? null : (
                /* A gap, because a tab touching the switcher reads as part of it. */
                <span className="ml-1 flex shrink-0 items-center gap-0.5">
                  {pinnedBoards.map((board) => {
                    const current = board.id === activeBoardId;
                    return (
                      <button
                        key={board.id}
                        type="button"
                        data-testid={`board-pinned-tab-${board.id}`}
                        data-active={current ? "true" : undefined}
                        aria-current={current ? "page" : undefined}
                        aria-label={board.name}
                        title={board.name}
                        className={`inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[12px] transition-colors ${
                          current
                            ? "bg-black/[0.07] font-medium text-[var(--ink)] dark:bg-white/15"
                            : "text-[var(--ink-muted)] hover:bg-black/[0.04] dark:hover:bg-white/10"
                        }`}
                        onClick={() => activateBoard(board.id)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setRowMenuRequest({
                            boardId: board.id,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                      >
                        <BoardGlyph board={board} />
                      </button>
                    );
                  })}
                </span>
              )}
              {canCreateBoards ? (
                <button
                  type="button"
                  data-testid="board-new-tab"
                  aria-label="New tab"
                  title="New tab"
                  className="inline-flex h-6 shrink-0 items-center rounded px-1.5 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                  onClick={openNewTab}
                >
                  +
                </button>
              ) : null}
              {/*
                The document's own controls sit beside the board name: undo and
                redo, the history drawer, and the outline. They were spread across
                a corner stack and the bottom dock, which put one group of
                controls in four places.
              */}
              {workspaceSurface && !readOnly ? (
                <span className="flex shrink-0 items-center gap-0.5" data-testid="board-nav">
                  <UndoRedo />
                  <InteractionModeToggle />
                  <button
                    type="button"
                    data-testid="history-toggle"
                    aria-label="Version history"
                    aria-pressed={historyOpen}
                    title="Version history"
                    className="board-nav-button"
                    onClick={toggleHistory}
                  >
                    <span aria-hidden="true" className="text-[13px] leading-none">
                      {"\u25f4"}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid="outline-control"
                    aria-label="Board outline"
                    aria-pressed={outlineOpen}
                    title="Board outline ([)"
                    className="board-nav-button"
                    onClick={toggleOutline}
                  >
                    <span aria-hidden="true" className="text-[13px] leading-none">
                      {"\u2630"}
                    </span>
                  </button>
                </span>
              ) : null}
            </>
          ) : null}
        </TitleBar>

        <main
          ref={boardRef}
          className={`board-surface relative z-10 min-h-0 flex-1${boardPainted ? " is-painted" : ""}`}
          style={boardPainted ? (boardPaint as CSSProperties) : undefined}
        >
          <CanvasBoard />
          {startPage ? (
            <div
              className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--surface)] px-4"
              data-testid="start-surface"
            >
              <StartPage
                boards={boards}
                cardCounts={boardCardCounts}
                canCreate={canCreateBoards}
                onOpen={activateBoard}
                onCreate={createBoard}
              />
            </div>
          ) : null}
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
          <TypeMenuHost />
          <AppearanceHost />
          <CardFocusHost />
          <TourOverlayHost />
          {/* Restoring writes a change, so history belongs to a session that may
              write; a viewer's copy is the relay's, and undo is the owner's. */}
          {workspaceSurface && !readOnly ? <HistoryPanelHost workspace={workspace} /> : null}
        </main>

        {workspaceSurface && !readOnly && !cardFocusId ? (
          <Dock
            // The badge and the inbox tab count the same rows: a board nothing opens
            // is an inbox row too, and a badge that leaves it out is a number the
            // drawer then contradicts (ADR-0063 §3).
            inboxCount={unplaced.length}
            libraryOpen={libraryOpen}
            onToggleLibrary={() => setLibraryOpen(!libraryOpen)}
            types={snapshot.types}
            boards={snapshot.boards}
            activeBoardId={activeBoardId}
            onCreateCard={createCard}
            onCreatePortal={createPortal}
            onCreateSketch={createSketch}
            onCreateSection={createSection}
            onCreateBoardPortal={createBoardPortal}
            onManageTypes={openTypeSettings}
            canManageSchema={canManageSchema}
            canCreateContent={canCreateContent}
            canCreateBoards={canCreateBoards}
          />
        ) : null}

        {workspaceSurface && canManageSchema ? <TypeSettingsHost /> : null}

        {workspaceSurface ? <CommandPaletteHost items={paletteItems} /> : null}

        {workspaceSurface && !readOnly ? (
          <LibraryDrawer
            open={libraryOpen}
            tab={libraryTab}
            counts={{
              // Boards are rows in Cards (and in the inbox when nothing opens
              // them), so their number is already inside these two.
              inbox: unplaced.length,
              cards: allCards.length + snapshot.boards.length,
              media: mediaItems.length,
              trash: trashed.length + trashedMediaItems.length,
            }}
            inbox={inboxItems}
            cards={cardItems}
            trash={trashItems}
            media={mediaItems}
            trashedMedia={trashedMediaItems}
            onPlaceMediaAsCard={(item) => createMediaCard(workspace, item).id}
            onTrashMedia={(id) => useUiStore.getState().trashMedia(id)}
            onRestoreMedia={(id) => useUiStore.getState().restoreMedia(id)}
            onDeleteMediaForever={(id) => {
              useUiStore.getState().restoreMedia(id);
              void purgeAttachment(id);
            }}
            boards={boardEntries}
            onCreateBoard={canCreateBoards ? createBoard : undefined}
            {...(canCreateContent
              ? {
                  onCreateCard: createCard,
                  onCreateSketch: createSketch,
                  onCreateSection: createSection,
                  onCreatePortal: (targetBoardId: string) => createPortal(targetBoardId),
                }
              : {})}
            onOpenBoard={activateBoard}
            onPlaceBoard={(boardId) => createPortal(boardId)}
            onUnplaceBoardCards={unplaceBoardCards}
            onDeleteBoard={deleteBoard}
            onLocateCard={locateCard}
            onLocateBoard={locateBoard}
            {...(canCreateBoards
              ? {
                  onUseBoardTemplate: useBoardTemplate,
                  onUseStarter: useStarter,
                  starters: BOARD_STARTERS,
                }
              : {})}
            {...(canManageBoards ? { onSetBoardTemplate: setBoardTemplate } : {})}
            onManageTypes={openTypeSettings}
            onTab={setLibraryTab}
            onClose={() => setLibraryOpen(false)}
            // A row handed over is a row in hand: the drawer steps out of the way so
            // the reader can see the board they are about to place on, exactly as the
            // multi-select "Place cards" button does.
            onPlace={(cardId) => {
              placeCard(cardId);
              setLibraryOpen(false);
            }}
            onCreateInInbox={() => workspace.createCard()}
            onTrash={(cardId) => workspace.trashCard(cardId)}
            onRestore={(cardId) => workspace.restoreCard(cardId)}
            onDeleteForever={(cardId) => workspace.purgeCard(cardId)}
            onEmptyTrash={() => workspace.emptyTrash()}
            onGoToBoard={activateBoard}
            onDropAt={(cardIds, point) => onDropSelection(cardIds, point)}
            onPlaceCards={(cardIds) => {
              startPlaceStack(cardIds);
              setLibraryOpen(false);
            }}
            canPlace={canEditLayout}
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
            full={libraryFull}
            onFull={setLibraryFull}
            sectionFilter={librarySectionFilter}
            onToggleSection={toggleLibrarySection}
            sectionOrder={sectionOrder}
            groupBySection={libraryGroupBySection}
            onToggleGroup={toggleLibraryGroupBySection}
            onOpenCard={openInspector}
            canManageTrash={canManageTrash}
          />
        ) : null}

        {/* The account surfaces: sign-in, and the admission panel while an account waits. */}
        {standalone ? null : (
          <Suspense fallback={<LoadingPlaceholder label="Loading sign-in" />}>
            <SignInSurface />
          </Suspense>
        )}

        {/* One dialog answers "which media", whether the `/` menu or the toolbar asked.
            It mounts in every profile: a standalone build still adds media locally. */}
        <MediaPickerHost />

        {/* The type a card's title and body declare, previewed before it is written. */}
        {workspaceSurface && canManageSchema ? (
          <BlueprintInstallHost workspace={workspace} />
        ) : null}

        {/* Toasts, the live regions and the failure routing, once for the shell. */}
        <FeedbackHost />
        {share === null ? <SendFeedbackBubble signedIn={phase === "signed-in"} /> : null}
        <PerfOverlay />
      </div>
    </SurfacePaintProvider.Provider>
  );
}
