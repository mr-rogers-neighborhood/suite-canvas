import type { PaletteSwatch, WorkspaceDocument } from "@suite/graph";
import type { CSSProperties, Dispatch, RefObject, SetStateAction } from "react";
import { lazy, Suspense } from "react";
import { SignInEntry } from "../auth/SignInEntry";
import { BoardOutlineHost } from "../canvas/BoardOutline";
import { CanvasBoard } from "../canvas/CanvasBoard";
import type { CanvasMode } from "../canvas/links/linkGesture";
import type { PlacementSource } from "../canvas/placementRun";
import { usePlacementRunStore } from "../canvas/placementRun";
import type { SurfacePalette } from "../canvas/rules";
import { SurfacePaintProvider } from "../canvas/surfaceContext";
import { CardFocusHost } from "../cards/CardFocusHost";
import { CardInspectorHost } from "../cards/CardInspectorHost";
import { TourOverlayHost } from "../cards/TourOverlayHost";
import { type BoardPresence, BoardTabs } from "../chrome/BoardTabs";
import { Dock } from "../chrome/Dock";
import { TitleBar } from "../chrome/TitleBar";
import { UndoRedo } from "../chrome/UndoRedo";
import { ViewsBar } from "../chrome/ViewsBar";
import { CommandPaletteHost } from "../command/CommandPalette";
import type { PaletteItem } from "../command/paletteRank";
import { PerfOverlay } from "../dev/PerfOverlay";
import { LeavingDialog } from "../dialogs/LeavingDialog";
import { FeedbackHost } from "../feedback/FeedbackHost";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { type LibraryBoard, LibraryDrawer, type LibraryItem } from "../library/LibraryDrawer";
import { BOARD_STARTERS } from "../library/TemplateGallery";
import { TypeSettingsHost } from "../panels/TypeSettingsHost";
import type { ShareSession } from "../session/session";
import { rememberWorkspaceName } from "../session/workspaceName";
import { SharePublishButton } from "../sharing/SharePublishButton";
import { StoragePanel } from "../sharing/StoragePanel";
import { LoadingPlaceholder } from "../shell/LoadingPlaceholder";
import type { useCanvasStore } from "../store/useCanvasStore";
import type { LibraryTab } from "../store/useUiStore";
import { useUiStore } from "../store/useUiStore";
import { AppearanceHost } from "./AppearanceHost";
import { BlueprintInstallHost } from "./BlueprintInstallHost";
import { HistoryPanelHost } from "./HistoryPanelHost";
import { documentLabel } from "./workspacePaint";

type UiState = ReturnType<typeof useUiStore.getState>;
type CanvasState = ReturnType<typeof useCanvasStore.getState>;

/**
 * The workspace actions pull in the share dialog, the recovery dialog and the
 * relay clients. Loading them on demand keeps `/api` out of the standalone
 * build's app chunk entirely, rather than relying on a runtime guard.
 */
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
  leavingPrompt: boolean;
  /** The workspace palette and the live role colours, for every surface painter. */
  palette: readonly PaletteSwatch[];
  roles: SurfacePalette;
  mode: "light" | "dark";
  requestLeave: () => void;
  setPaletteOpen: UiState["setPaletteOpen"];
  standalone: boolean;
  status: CanvasState["status"];
  share: ShareSession | null;
  peerCount: number;
  workspaceId: string;
  workspace: WorkspaceDocument;
  workspaceName: string;
  setWorkspaceName: Dispatch<SetStateAction<string>>;
  signedIn: boolean;
  inRoom: boolean;
  openSignIn: () => void;
  readOnly: boolean;
  setStylesOpen: UiState["setStylesOpen"];
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
  openBoards: WorkspaceSnapshot["boards"];
  openBoardIds: string[];
  boardHistory: UiState["boardHistory"];
  goBackBoard: UiState["goBackBoard"];
  navigation: { homeBoardId: string | null; newTabBoardId: string | null };
  peersByBoard: Record<string, BoardPresence>;
  activateBoard: UiState["activateBoard"];
  closeBoardTab: UiState["closeBoardTab"];
  runCards: (cardIds: readonly string[], mode: CanvasMode, source: PlacementSource) => void;
  boardPainted: boolean;
  boardPaint: Record<string, string>;
  boardEmpty: boolean;
  sharedEmpty: boolean;
  createCard: (typeId: string, point?: { x: number; y: number }) => string | undefined;
  createCardInRun: (typeId: string) => void;
  createPortal: (targetBoardId: string) => void;
  createSketch: () => void;
  createSection: () => void;
  createBoardPortal: () => void;
  openTypeSettings: UiState["openTypeSettings"];
  stylesOpen: boolean;
  paletteItems: PaletteItem[];
  unplaced: string[];
  trashed: string[];
  allCards: string[];
  trashItems: LibraryItem[];
  cardFocusId: string | null;
  inboxItems: LibraryItem[];
  cardItems: LibraryItem[];
  boardEntries: LibraryBoard[];
  unplaceBoardCards: (boardId: string) => void;
  deleteBoard: (boardId: string, cards: "keep" | "trash") => void;
  locateCard: (cardId: string) => boolean;
  locateBoard: (boardId: string) => boolean;
  useBoardTemplate: (templateId: string) => void;
  useStarter: (starterId: string) => void;
  setBoardTemplate: (boardId: string, template: boolean) => void;
  setLibraryTab: UiState["setLibraryTab"];
  placeCard: (cardId: string, point?: { x: number; y: number }) => void;
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
  startPlacementLoop: (cardIds: readonly string[]) => void;
  placementRunStep: () => void;
  placementRunActive: boolean;
  leaveAnyway: () => void;
  dismissLeavePrompt: () => void;
}

export function WorkspaceShellView({
  shellRef,
  boardRef,
  ready,
  synced,
  leaving,
  leavingPrompt,
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
  signedIn,
  inRoom,
  openSignIn,
  readOnly,
  setStylesOpen,
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
  openBoards,
  openBoardIds,
  boardHistory,
  goBackBoard,
  navigation,
  peersByBoard,
  activateBoard,
  closeBoardTab,
  runCards,
  boardPainted,
  boardPaint,
  boardEmpty,
  sharedEmpty,
  createCard,
  createCardInRun,
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
  startPlacementLoop,
  placementRunStep,
  placementRunActive,
  leaveAnyway,
  dismissLeavePrompt,
}: WorkspaceShellViewProps) {
  return (
    <SurfacePaintProvider.Provider value={{ palette, roles, mode }}>
      <div
        ref={shellRef}
        className="app-canvas flex h-screen w-screen flex-col"
        data-ready={ready && synced}
        data-leaving={leaving ? "true" : undefined}
      >
        <TitleBar
          onNavigateHome={requestLeave}
          onOpenSearch={() => setPaletteOpen(true)}
          // A standalone build never opens a socket, so "Syncing" would be a lie;
          // the status slot reports the connection it has (none) beside the note.
          status={standalone ? "disconnected" : status}
          {...(share ? { role: share.role } : {})}
          peerCount={standalone ? 0 : peerCount}
          signedIn={signedIn}
          workspaceId={workspaceId}
          onSignIn={openSignIn}
          // Everything about *this* device's copy lives under the same control that
          // says who else is here (ADR-0064 amendment): one status, one press.
          storage={
            <StoragePanel
              workspaceId={workspaceId}
              signedIn={signedIn}
              synced={inRoom}
              onSignIn={openSignIn}
            />
          }
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
                <Suspense
                  fallback={
                    <LoadingPlaceholder variant="inline" label="Loading workspace actions" />
                  }
                >
                  <WorkspaceActions
                    workspaceId={workspaceId}
                    boardId={activeBoardId}
                    title={activeBoardName ?? "Workspace"}
                    onLeave={requestLeave}
                    {...(canManageSchema ? { onOpenStyles: () => setStylesOpen(true) } : {})}
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
          {workspaceSurface ? (
            <>
              <div className="views-bar">
                <ViewsBar
                  canManage={canManageSchema}
                  // A view's result is a queue like any other; the view's sorts are
                  // the order, so a threaded run follows the list on screen.
                  {...(canEditLayout
                    ? {
                        onPlaceResults: (cardIds: readonly string[]) =>
                          runCards(cardIds, useUiStore.getState().mode, "view"),
                      }
                    : {})}
                />
              </div>
              {/*
              A way back exists only where the reader was *taken* somewhere: a
              portal entry. Tab clicks already leave every board one click away,
              so a chevron for those was a second, single-direction control in
              the busiest corner of the bar.
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
              <BoardTabs
                boards={openBoards}
                activeBoardId={activeBoardId}
                homeBoardId={navigation.homeBoardId}
                newTabBoardId={navigation.newTabBoardId}
                openableBoards={snapshot.boards.filter((board) => !openBoardIds.includes(board.id))}
                onSelect={activateBoard}
                peersByBoard={peersByBoard}
                canCreateBoards={canCreateBoards}
                canManageBoards={canManageBoards}
                onCreate={() => {
                  const board = workspace.createBoard();
                  activateBoard(board.id);
                }}
                onRename={(boardId, name) => workspace.renameBoard(boardId, name)}
                onClose={closeBoardTab}
              />
              {/*
                The rest of the navigation sits in the same row as the tabs: undo
                and redo of the document, the history drawer, and the outline. They
                were spread across a corner stack and the bottom dock, which put one
                group of controls in four places.
              */}
              {workspaceSurface && !readOnly ? (
                <span className="flex shrink-0 items-center gap-0.5" data-testid="board-nav">
                  <UndoRedo />
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
          <AppearanceHost />
          <CardFocusHost />
          <TourOverlayHost />
          {/* Restoring writes a change, so history belongs to a session that may
              write; a viewer's copy is the relay's, and undo is the owner's. */}
          {workspaceSurface && !readOnly ? <HistoryPanelHost workspace={workspace} /> : null}
        </main>

        {workspaceSurface && !readOnly && !cardFocusId ? (
          <Dock
            inboxCount={unplaced.length}
            libraryOpen={libraryOpen}
            onToggleLibrary={() => setLibraryOpen(!libraryOpen)}
            types={snapshot.types}
            boards={snapshot.boards}
            activeBoardId={activeBoardId}
            onCreateCard={createCardInRun}
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
              inbox: unplaced.length,
              cards: allCards.length,
              boards: snapshot.boards.length,
              trash: trashed.length,
            }}
            inbox={inboxItems}
            cards={cardItems}
            trash={trashItems}
            boards={boardEntries}
            onOpenBoard={activateBoard}
            onPlaceBoard={createPortal}
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
            onRunCards={(cardIds, runMode) => runCards(cardIds, runMode, "selection")}
            onQueueCards={(cardIds) => {
              usePlacementRunStore.getState().enqueue(cardIds);
              placementRunStep();
            }}
            onRunLoop={(cardIds) => startPlacementLoop(cardIds)}
            runActive={placementRunActive}
            canManageTrash={canManageTrash}
          />
        ) : null}

        {/* The account surfaces: sign-in, and the admission panel while an account waits. */}
        {standalone ? null : (
          <Suspense fallback={<LoadingPlaceholder label="Loading sign-in" />}>
            <SignInSurface />
          </Suspense>
        )}

        {/* The way out, when this browser is the only place the work exists. */}
        {leavingPrompt ? (
          <LeavingDialog
            workspaceId={workspaceId}
            title={workspaceName}
            {...(standalone ? {} : { onSignIn: openSignIn })}
            onLeave={leaveAnyway}
            onDismiss={dismissLeavePrompt}
          />
        ) : null}

        {/* The type a card's title and body declare, previewed before it is written. */}
        {workspaceSurface && canManageSchema ? (
          <BlueprintInstallHost workspace={workspace} />
        ) : null}

        {/* Toasts, the live regions and the failure routing, once for the shell. */}
        <FeedbackHost />
        <PerfOverlay />
      </div>
    </SurfacePaintProvider.Provider>
  );
}
