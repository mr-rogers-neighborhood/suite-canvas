import { PORTAL_BOARD_FIELD_ID } from "@suite/graph";
import { ReactFlowProvider, useOnViewportChange, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shellPaletteItems } from "./app/palette";
import { StaleBuildNotice } from "./app/StaleBuildNotice";
import { useBoardDerivations } from "./app/useBoardDerivations";
import { useBoardPaletteActions } from "./app/useBoardPaletteActions";
import { useLeaveGuard } from "./app/useLeaveGuard";
import { useStaleBuild } from "./app/useStaleBuild";
import { useWorkspaceBoot } from "./app/useWorkspaceBoot";
import { useWorkspaceSyncFacts } from "./app/useWorkspaceSyncFacts";
import { WorkspaceShellView } from "./app/WorkspaceShellView";
import { useSurfacePalette, useWorkspacePalette } from "./app/workspacePaint";
import { signedIn as accountSignedIn, useAccountStore } from "./auth/useAccountStore";
import { DEFAULT_PORTAL_SIZE } from "./canvas/PortalCard";
import { usePlaceStackStore } from "./canvas/placeStack";
import type { CanvasPurpose } from "./canvas/purpose";
import { useRecordEngine } from "./canvas/useRecordEngine";
import { zoomBand } from "./canvas/zoomRange";
import { ensureTutorialType, tutorialCardOnBoard } from "./cards/tour";
import { ensureWhiteboardType } from "./cards/whiteboard";
import type { BoardPresence } from "./chrome/BoardSwitcher";
import { BootSkeleton } from "./chrome/BootSkeleton";
import { useSavedViews } from "./chrome/ViewsBar";
import { usePresenceStore } from "./collab/usePresenceStore";
import { countRender } from "./dev/perf";
import { useBootGate } from "./hooks/useBootGate";
import { LIBRARY_SEARCH_FOCUS_EVENT } from "./hooks/useLibrarySearch";
import { WorkspaceLauncher } from "./launcher/WorkspaceLauncher";
import type { LibraryItem } from "./library/LibraryDrawer";
import { toBoardItems, unopenedBoards } from "./library/libraryBoards";
import { createStarterBoard, templateCopyName } from "./library/TemplateGallery";
import { isStandalone } from "./session/mode";
import { getSession, type ShareSession } from "./session/session";
import { useCanvasStore } from "./store/useCanvasStore";
import { useUiStore } from "./store/useUiStore";
import { useWorkspaceSnapshot } from "./store/workspaceStore";
import { initTheme, useThemeStore } from "./theme/useThemeStore";

/** Half of the default card box (`w-72`), so a dropped card lands under the pointer. */
const CARD_HALF_WIDTH = 144;
const CARD_HALF_HEIGHT = 60;

export default function App() {
  useEffect(() => initTheme(), []);
  // A tab can outlive several deploys; the notice is how a reader learns that the
  // bug they are looking at was fixed an hour ago (see `staleBuild`).
  const stale = useStaleBuild();

  const session = getSession();
  const workspaceId = session.workspaceId;
  if (!workspaceId) return <WorkspaceLauncher />;

  return (
    <ReactFlowProvider>
      <WorkspaceShell workspaceId={workspaceId} share={session.share} />
      {stale ? <StaleBuildNotice onReload={() => window.location.reload()} /> : null}
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
  const [workspaceName, setWorkspaceName] = useState(() => workspace.workspaceName());
  const connect = useCanvasStore((state) => state.connect);
  const provider = useCanvasStore((state) => state.provider);
  const presence = useCanvasStore((state) => state.presence);
  const status = useCanvasStore((state) => state.status);
  const ready = useCanvasStore((state) => state.ready);
  const synced = useCanvasStore((state) => state.synced);
  // The skeleton stays until the workspace has a first sync *or* this build will
  // never sync. Seeding waits for that same moment, so a new workspace used to
  // open on an empty canvas for the length of the grace period; holding the
  // skeleton there is the honest picture of what is happening.
  const boot = useBootGate(ready && (synced || isStandalone()));
  const { screenToFlowPosition } = useReactFlow();
  const snapshot = useWorkspaceSnapshot();
  countRender("shell");

  // The shell paints from the token layer and nothing else: a workspace has no
  // shell style, no palette and no rules.
  const shellRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const workspacePalette = useWorkspacePalette(workspace);
  const themeMode = useThemeStore((state) => state.mode);
  // The resolved brightness, which is what a swatch resolves against.
  const theme = useThemeStore((state) => state.theme);
  const palette = useSurfacePalette(shellRef, themeMode);

  // Content breakpoints (ADR-0051): the band rides the board root as an
  // attribute, written straight to the element so a zoom gesture does not
  // re-render the shell. CanvasBoard owns the camera, so this is the reader's
  // side of the same decision.
  useOnViewportChange({
    onChange: (viewport) => {
      const node = boardRef.current;
      if (!node) return;
      const band = zoomBand(viewport.zoom);
      if (node.dataset.zoomBand !== band) node.dataset.zoomBand = band;
    },
  });

  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const setActiveBoardId = useUiStore((state) => state.setActiveBoardId);
  const libraryOpen = useUiStore((state) => state.libraryOpen);
  const libraryTab = useUiStore((state) => state.libraryTab);
  const setLibraryOpen = useUiStore((state) => state.setLibraryOpen);
  const historyOpen = useUiStore((state) => state.historyOpen);
  const toggleHistory = useUiStore((state) => state.toggleHistory);
  const outlineOpen = useUiStore((state) => state.outlineOpen);
  const toggleOutline = useUiStore((state) => state.toggleOutline);
  const requestShare = useUiStore((state) => state.requestShare);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const selectSection = useUiStore((state) => state.selectSection);
  const savedViews = useSavedViews(workspace);
  const setThemeMode = useThemeStore((state) => state.setMode);
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
  /** What the canvas is for (ADR-0064); the control owns the click, this owns the effect. */
  const purpose = useUiStore((state) => state.purpose);
  const libraryFull = useUiStore((state) => state.libraryFull);
  const setLibraryFull = useUiStore((state) => state.setLibraryFull);
  const toggleLibraryGroupBySection = useUiStore((state) => state.toggleLibraryGroupBySection);
  const cardFocusId = useUiStore((state) => state.cardFocusId);
  const inspectorNodeId = useUiStore((state) => state.inspectorNodeId);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const paletteOpen = useUiStore((state) => state.paletteOpen);
  const activeViewId = useUiStore((state) => state.activeViewId);
  const applyView = useUiStore((state) => state.applyView);
  const exitView = useUiStore((state) => state.exitView);
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const readOnly = useUiStore((state) => state.readOnly);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canPublish = useUiStore((state) => state.canPublish);
  const canCreateContent = useUiStore((state) => state.canCreateContent);
  const canCreateBoards = useUiStore((state) => state.canCreateBoards);
  const canManageBoards = useUiStore((state) => state.canManageBoards);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const canManageTrash = useUiStore((state) => state.canManageTrash);
  const canManageLinks = useUiStore((state) => state.canManageLinks);
  const setFocus = usePresenceStore((state) => state.setFocus);
  const setBoard = usePresenceStore((state) => state.setBoard);
  const bindPresence = usePresenceStore((state) => state.bind);
  const peerCount = usePresenceStore((state) => Object.keys(state.peers).length);
  // One dot per board with company. The store's peer map is replaced only when
  // presence changes, so this memo is stable between pointer ticks; `useShallow`
  // is not enough because each board's label/colour pair is a new object.
  const peers = usePresenceStore((state) => state.peers);
  const peersByBoard = useMemo(() => {
    const names = new Map<string, Set<string>>();
    const colors = new Map<string, string>();
    for (const peer of Object.values(peers)) {
      if (!peer.board) continue;
      const set = names.get(peer.board) ?? new Set<string>();
      set.add(peer.user.name);
      names.set(peer.board, set);
      if (!colors.has(peer.board)) colors.set(peer.board, peer.user.color);
    }
    const map: Record<string, BoardPresence> = {};
    for (const [boardId, set] of names) {
      map[boardId] = {
        label: [...set].sort().join(", "),
        color: colors.get(boardId) ?? "var(--section-violet)",
      };
    }
    return map;
  }, [peers]);
  const activateBoard = useUiStore((state) => state.activateBoard);
  const boardRecency = useUiStore((state) => state.boardRecency);
  const newTab = useUiStore((state) => state.newTab);
  const openNewTab = useUiStore((state) => state.openNewTab);
  const focusCard = useUiStore((state) => state.focusCard);
  const goBackBoard = useUiStore((state) => state.goBackBoard);
  const boardHistory = useUiStore((state) => state.boardHistory);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);

  // The live workspace surface — dock, library, boards and schema — belongs to
  // the owner and to a workspace editor token. Board and card shares edit one
  // projection and publish it, so they never see it.
  const workspaceSurface = !share || share.scope === "workspace";

  // Opening the library is a request to search it: the drawer owns the input,
  // so the shell asks it to take the keyboard on every open — the dock button,
  // ⌘⇧K, a palette row or an applied view all arrive here.
  const libraryWasOpen = useRef(libraryOpen);
  useEffect(() => {
    if (libraryOpen && !libraryWasOpen.current) {
      window.dispatchEvent(new Event(LIBRARY_SEARCH_FOCUS_EVENT));
    }
    libraryWasOpen.current = libraryOpen;
  }, [libraryOpen]);

  const stagger = useRef(0);
  // A standalone build renders from IndexedDB alone: no socket, no presence and
  // no sharing, all decided once at build time.
  const standalone = isStandalone();

  // The account is read once by `SignInDialogHost`; the header and the storage
  // ladder only consume the answer. A device with no account is signed out, which
  // is where it already was — nothing about the local path changes (ADR-0067 §6).
  const signedIn = useAccountStore(accountSignedIn);
  const accountPhase = useAccountStore((state) => state.phase);
  const openPanel = useAccountStore((state) => state.openPanel);
  const syncFacts = useWorkspaceSyncFacts({
    workspaceId: workspaceId ?? "",
    phase: accountPhase,
    status,
    workspaceName,
    shared: share !== null,
  });
  const openSignIn = useAccountStore((state) => state.openSignIn);
  const { leaving, leavingPrompt, inRoom, requestLeave, dismissLeavePrompt, leaveAnyway } =
    useLeaveGuard({ standalone, peerCount, signedIn, share, workspace });

  useWorkspaceBoot({
    workspace,
    workspaceId,
    workspaceName,
    setWorkspaceName,
    snapshot,
    share,
    readOnly,
    ready,
    synced,
    standalone,
    activeBoardId,
    newTab,
    setActiveBoardId,
    connect,
    provider,
    presence,
    bindPresence,
    setBoard,
    editingNodeId,
    editingField,
    setFocus,
    openInspector,
  });

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

  /** Returns the new card's id, so a caller can open what it just made. */
  const createCard = useCallback(
    (typeId: string, point?: { x: number; y: number }) => {
      if (!activeBoardId) return undefined;
      const position = point ? canvasPoint(point) : canvasPoint();
      const card = workspace.createCard({ typeId, boardId: activeBoardId, position });
      startEditing(card.id, "title");
      return card.id;
    },
    [activeBoardId, canvasPoint, workspace, startEditing],
  );

  /** Clicks become steps, so recording has one engine beside the placement one. */
  const recordEngine = useRecordEngine();

  /**
   * Recording starts with the tour itself (ADR-0064 §9): entering `record` opens
   * the tutorial the clicks will be captured into, and arms the capture. A second
   * entry focuses the tour already on this board instead of minting a second card
   * (ADR-0064 §9), because the steps belong to one timeline.
   *
   * The panel is opened too, not just the tour flag: the Steps list is where the
   * captured steps appear, and a record with no destination is a label.
   */
  const startRecording = useCallback(() => {
    if (!canCreateContent || !canEditContent) return;
    // The tour already in front of the author is the destination; only when
    // there is none does the board's own tutorial (or a new card) take over.
    const open = useUiStore.getState().tour?.tutorialId ?? null;
    const existing = tutorialCardOnBoard(workspace, activeBoardId, open);
    const tutorialId = existing ?? createCard(ensureTutorialType(workspace).id);
    if (!tutorialId) return;
    openInspector(tutorialId);
    useUiStore.getState().openTour(tutorialId);
    recordEngine.start(tutorialId);
  }, [
    activeBoardId,
    canCreateContent,
    canEditContent,
    createCard,
    openInspector,
    recordEngine,
    workspace,
  ]);

  /**
   * What a purpose starts. A record begins with its tutorial card; a run does not begin
   * here at all, because a run needs a queue and only the library has one to give.
   *
   * The previous value is a ref so a callback that changes identity cannot start a
   * second recording; the purpose itself is the trigger.
   */
  const previousPurpose = useRef<CanvasPurpose>(purpose);
  useEffect(() => {
    if (previousPurpose.current === purpose) return;
    previousPurpose.current = purpose;
    if (purpose === "record") startRecording();
  }, [purpose, startRecording]);

  /**
   * Dock-created portals land at the viewport centre, centred on the pointer
   * the way a placed card is. The card and its target are one commit.
   */
  const createPortal = useCallback(
    (targetBoardId: string, point?: { x: number; y: number }) => {
      if (!activeBoardId || !canCreateContent) return;
      const at = point ? canvasPoint(point) : canvasPoint();
      const card = workspace.createPortalCard({
        boardId: activeBoardId,
        targetBoardId,
        position: {
          x: at.x - DEFAULT_PORTAL_SIZE.width / 2,
          y: at.y - DEFAULT_PORTAL_SIZE.height / 2,
        },
      });
      setSelectedNodeIds([card.id]);
    },
    [activeBoardId, canvasPoint, workspace, canCreateContent, setSelectedNodeIds],
  );

  /** The rows that act on the document, so the palette and the dock agree. */
  const boardActions = useBoardPaletteActions();

  /**
   * The palette's entries, built from the command registry. Navigation and
   * creation are wired to the same store actions and helpers the shell already
   * uses, so the palette cannot drift from the controls it duplicates.
   */
  const paletteItems = useMemo(
    () =>
      shellPaletteItems({
        ...boardActions,
        workspace,
        snapshot,
        savedViews,
        activeBoardId,
        activeViewId,
        cardFocusId,
        inspectorNodeId,
        selectedNodeIds,
        workspaceSurface,
        readOnly,
        paletteOpen,
        libraryOpen,
        libraryTab,
        canEditContent,
        canEditLayout,
        canPublish,
        canCreateContent,
        canCreateBoards,
        canManageBoards,
        canManageSchema,
        canManageTrash,
        canManageLinks,
        activateBoard,
        selectSection,
        openCardFocus,
        openInspector,
        applyView,
        exitView,
        createCard,
        canvasPoint,
        placeCard,
        setLibraryOpen,
        setPaletteOpen,
        setLibraryTab,
        openTypeSettings,
        requestShare,
        setThemeMode,
        themeMode,
      }),
    [
      boardActions,
      snapshot,
      savedViews,
      activeBoardId,
      activeViewId,
      workspace,
      workspaceSurface,
      readOnly,
      paletteOpen,
      libraryOpen,
      libraryTab,
      cardFocusId,
      inspectorNodeId,
      selectedNodeIds,
      canEditContent,
      canEditLayout,
      canPublish,
      canCreateContent,
      canCreateBoards,
      canManageBoards,
      canManageSchema,
      canManageTrash,
      canManageLinks,
      activateBoard,
      selectSection,
      openCardFocus,
      openInspector,
      applyView,
      exitView,
      createCard,
      canvasPoint,
      placeCard,
      setLibraryOpen,
      setPaletteOpen,
      setLibraryTab,
      openTypeSettings,
      requestShare,
      setThemeMode,
      themeMode,
    ],
  );

  /**
   * A new sketch, placed where the dock's card would land and opened in the
   * focus surface. The result matches the canvas's own "New sketch" menu item.
   */
  const createSketch = useCallback(() => {
    if (!canCreateContent) return;
    createCard(ensureWhiteboardType(workspace).id);
  }, [canCreateContent, createCard, workspace]);

  /** A new section around nothing, centred where a new card would land. */
  const createSection = useCallback(() => {
    if (!activeBoardId || !canCreateContent) return;
    const centre = canvasPoint();
    workspace.createSection({ boardId: activeBoardId, x: centre.x - 180, y: centre.y - 130 });
  }, [activeBoardId, canCreateContent, workspace, canvasPoint]);

  const createBoardPortal = useCallback(() => {
    if (!activeBoardId || !canCreateBoards) return;
    const board = workspace.createBoard();
    createPortal(board.id);
  }, [activeBoardId, canCreateBoards, workspace, createPortal]);

  const { activeBoardName, boardPaint, boardPainted, sectionOrder, sectionIdsFor } =
    useBoardDerivations({ snapshot, activeBoardId });

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
  const boardItems = useMemo(() => toBoardItems(snapshot), [snapshot]);
  const inboxBoardItems = useMemo(() => unopenedBoards(boardItems), [boardItems]);
  const inboxItems = [...unplaced.map(toItem), ...inboxBoardItems];
  const cardItems = [...allCards.map(toItem), ...boardItems];
  const trashItems = trashed.map(toItem);

  /**
   * The library's board rows: boards are items in the same list as cards, and one
   * nothing points at waits in the inbox with the loose cards.
   */

  /**
   * Locate pans to the object on the board in front of the reader. A card that
   * is not placed here has nowhere to pan to, so the drawer is told so instead
   * of the camera moving somewhere unrelated.
   */
  const locateCard = useCallback(
    (cardId: string): boolean => {
      if (!activeBoardId) return false;
      const card = workspace.getCard(cardId);
      if (!card || card.deletedAt) return false;
      const onBoard = snapshot.placements.some(
        (placement) => placement.boardId === activeBoardId && placement.cardId === cardId,
      );
      if (!onBoard) return false;
      focusCard(cardId, activeBoardId);
      return true;
    },
    [activeBoardId, snapshot.placements, workspace, focusCard],
  );

  /** A portal on this board is the nearest thing a board has to a position. */
  const locateBoard = useCallback(
    (boardId: string): boolean => {
      if (activeBoardId && activeBoardId !== boardId) {
        const portal = snapshot.placements
          .filter((placement) => placement.boardId === activeBoardId)
          .map((placement) => workspace.getCard(placement.cardId))
          .find(
            (card) =>
              card !== undefined &&
              !card.deletedAt &&
              card.properties[PORTAL_BOARD_FIELD_ID] === boardId,
          );
        if (portal) {
          focusCard(portal.id, activeBoardId);
          return true;
        }
      }
      // Without a portal here, opening the board is the only way to show it.
      activateBoard(boardId);
      return true;
    },
    [activeBoardId, snapshot.placements, workspace, focusCard, activateBoard],
  );

  /** Unplacing is per board: a card that also lives elsewhere stays there. */
  const unplaceBoardCards = useCallback(
    (boardId: string) => {
      if (!canEditLayout) return;
      for (const card of workspace.listBoardCards(boardId)) {
        workspace.unplaceCard(boardId, card.id);
      }
    },
    [canEditLayout, workspace],
  );

  /**
   * Delete asks once, in the library. If the board on screen goes, the shell
   * resolves the next one the same way it resolves a boot.
   */
  const deleteBoard = useCallback(
    (boardId: string, cards: "keep" | "trash") => {
      if (!canManageBoards) return;
      workspace.deleteBoard(boardId, { cards });
      if (useUiStore.getState().activeBoardId === boardId) setActiveBoardId(null);
    },
    [canManageBoards, workspace, setActiveBoardId],
  );

  /**
   * Using a template *duplicates* it: sections, cards, placements and internal
   * links land as a new board in one undoable batch, and the template itself is
   * never written. The drawer closes because the new board is now in front.
   */
  const useBoardTemplate = useCallback(
    (templateId: string) => {
      if (!canCreateBoards) return;
      const source = workspace.getBoard(templateId);
      if (!source) return;
      const existing = workspace.listBoards().map((board) => board.name);
      const board = workspace.duplicateBoard(templateId, {
        name: templateCopyName(source.name, existing),
      });
      if (!board) return;
      activateBoard(board.id);
      setLibraryOpen(false);
    },
    [canCreateBoards, workspace, activateBoard, setLibraryOpen],
  );

  /** A built-in starter is generated on pick, never on boot. */
  const useStarter = useCallback(
    (starterId: string) => {
      if (!canCreateBoards) return;
      const existing = workspace.listBoards().map((board) => board.name);
      const boardId = createStarterBoard(workspace, starterId, existing);
      if (!boardId) return;
      activateBoard(boardId);
      setLibraryOpen(false);
    },
    [canCreateBoards, workspace, activateBoard, setLibraryOpen],
  );

  /** The flag is the whole feature: it never changes what the board holds. */
  const setBoardTemplate = useCallback(
    (boardId: string, template: boolean) => {
      if (!canManageBoards) return;
      workspace.setBoardTemplate(boardId, template);
    },
    [canManageBoards, workspace],
  );

  const boardEmpty = !!activeBoardId && workspace.listBoardCards(activeBoardId).length === 0;
  // A projection can arrive empty when the owner's cards left the board — the
  // link still works, so the viewer gets one honest line instead of the
  // owner's creation prompt, which they cannot act on anyway.
  const sharedEmpty = boardEmpty && !!share && !canCreateContent;

  // Local hydration is the only thing the first paint waits for. Remote sync
  // continues underneath; the skeleton must never become a server spinner.
  if (boot.show) return <BootSkeleton exiting={boot.exiting} />;

  return (
    <WorkspaceShellView
      shellRef={shellRef}
      boardRef={boardRef}
      ready={ready}
      synced={synced}
      leaving={leaving}
      leavingPrompt={leavingPrompt}
      palette={workspacePalette}
      roles={palette}
      mode={theme}
      requestLeave={requestLeave}
      setPaletteOpen={setPaletteOpen}
      standalone={standalone}
      status={status}
      share={share}
      peerCount={peerCount}
      workspaceId={workspaceId}
      workspace={workspace}
      workspaceName={workspaceName}
      setWorkspaceName={setWorkspaceName}
      phase={accountPhase}
      claim={syncFacts.claim}
      reason={syncFacts.reason}
      onSeePlans={() => openPanel("plan")}
      inRoom={inRoom}
      openSignIn={openSignIn}
      readOnly={readOnly}
      activeBoardId={activeBoardId}
      activeBoardName={activeBoardName}
      canManageSchema={canManageSchema}
      workspaceSurface={workspaceSurface}
      canEditLayout={canEditLayout}
      canCreateContent={canCreateContent}
      canCreateBoards={canCreateBoards}
      canManageBoards={canManageBoards}
      canManageTrash={canManageTrash}
      setLibraryOpen={setLibraryOpen}
      libraryOpen={libraryOpen}
      historyOpen={historyOpen}
      toggleHistory={toggleHistory}
      outlineOpen={outlineOpen}
      toggleOutline={toggleOutline}
      libraryTab={libraryTab}
      snapshot={snapshot}
      boardRecency={boardRecency}
      newTab={newTab}
      openNewTab={openNewTab}
      boardHistory={boardHistory}
      goBackBoard={goBackBoard}
      peersByBoard={peersByBoard}
      createBoard={() => {
        const board = workspace.createBoard();
        activateBoard(board.id);
      }}
      activateBoard={activateBoard}
      boardPainted={boardPainted}
      boardPaint={boardPaint}
      boardEmpty={boardEmpty}
      sharedEmpty={sharedEmpty}
      createCard={createCard}
      createPortal={createPortal}
      createSketch={createSketch}
      createSection={createSection}
      createBoardPortal={createBoardPortal}
      openTypeSettings={openTypeSettings}
      paletteItems={paletteItems}
      unplaced={unplaced}
      trashed={trashed}
      allCards={allCards}
      trashItems={trashItems}
      cardFocusId={cardFocusId}
      inboxItems={inboxItems}
      cardItems={cardItems}
      boardEntries={boardItems}
      unplaceBoardCards={unplaceBoardCards}
      deleteBoard={deleteBoard}
      locateCard={locateCard}
      locateBoard={locateBoard}
      useBoardTemplate={useBoardTemplate}
      useStarter={useStarter}
      setBoardTemplate={setBoardTemplate}
      setLibraryTab={setLibraryTab}
      placeCard={placeCard}
      startPlaceStack={(cardIds) => usePlaceStackStore.getState().start(cardIds)}
      toggleLibraryType={toggleLibraryType}
      toggleLibraryTag={toggleLibraryTag}
      clearLibraryFilters={clearLibraryFilters}
      libraryTypeFilter={libraryTypeFilter}
      libraryTagFilter={libraryTagFilter}
      libraryScope={libraryScope}
      setLibraryScope={setLibraryScope}
      libraryFull={libraryFull}
      setLibraryFull={setLibraryFull}
      librarySectionFilter={librarySectionFilter}
      toggleLibrarySection={toggleLibrarySection}
      sectionOrder={sectionOrder}
      libraryGroupBySection={libraryGroupBySection}
      toggleLibraryGroupBySection={toggleLibraryGroupBySection}
      openInspector={openInspector}
      leaveAnyway={leaveAnyway}
      dismissLeavePrompt={dismissLeavePrompt}
    />
  );
}
