import {
  defaultConnectors,
  PORTAL_BOARD_FIELD_ID,
  resolveSurfaceStyle,
  type StyleRule,
  type SurfaceStyle,
  sectionForCard,
  sectionMembership,
  type WorkspaceDocument,
} from "@suite/graph";
import { ReactFlowProvider, useOnViewportChange, useReactFlow } from "@xyflow/react";
import {
  type CSSProperties,
  lazy,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SignInEntry } from "./auth/SignInEntry";
import { signedIn as accountSignedIn, useAccountStore } from "./auth/useAccountStore";
import { BoardOutlineHost } from "./canvas/BoardOutline";
import { CanvasBoard } from "./canvas/CanvasBoard";
import type { CanvasMode } from "./canvas/linkGesture";
import { prefersReducedMotion } from "./canvas/localEasing";
import { DEFAULT_CARD_WIDTH } from "./canvas/multiSelect";
import { outlineRows } from "./canvas/outlineTree";
import { DEFAULT_PORTAL_SIZE } from "./canvas/PortalCard";
import { type PlacementSource, usePlacementRunStore } from "./canvas/placementRun";
import type { CanvasPurpose } from "./canvas/purpose";
import {
  readPalette,
  type SurfacePalette,
  SurfaceRulesContext,
  shellPaintFor,
} from "./canvas/rules";
import { surfacePaintVars } from "./canvas/surfacePaint";
import { usePlacementEngine } from "./canvas/usePlacementEngine";
import { useRecordEngine } from "./canvas/useRecordEngine";
import { zoomBand } from "./canvas/zoomRange";
import { ensureTutorialType, tutorialCardOnBoard } from "./cards/tour";
import { ensureWhiteboardType } from "./cards/whiteboard";
import { TAB_ID } from "./collab/tabId";
import { usePresenceStore } from "./collab/usePresenceStore";
import { type BoardPresence, BoardTabs } from "./components/BoardTabs";
import { BootSkeleton } from "./components/BootSkeleton";
import { CardFocusHost } from "./components/CardFocusHost";
import { CardInspectorHost } from "./components/CardInspectorHost";
import { CommandPaletteHost } from "./components/CommandPalette";
import { sectionPath } from "./components/cardWhere";
import type { Capability } from "./components/commandRegistry";
import { Dock } from "./components/Dock";
import { LeavingDialog } from "./components/LeavingDialog";
import { type LibraryBoard, LibraryDrawer, type LibraryItem } from "./components/LibraryDrawer";
import { UNSORTED_SECTION } from "./components/libraryFilters";
import { buildPaletteItems } from "./components/paletteProviders";
import { SharePublishButton } from "./components/SharePublishButton";
import { StoragePanel } from "./components/StoragePanel";
import { BOARD_STARTERS, createStarterBoard, templateCopyName } from "./components/TemplateGallery";
import { TitleBar } from "./components/TitleBar";
import { TourOverlayHost } from "./components/TourOverlayHost";
import { TypeSettingsHost } from "./components/TypeSettingsHost";
import { useSavedViews, ViewsBar } from "./components/ViewsBar";
import { markBoot, measureBoot } from "./dev/bootTiming";
import { PerfOverlay } from "./dev/PerfOverlay";
import { countRender } from "./dev/perf";
import { useBootGate } from "./hooks/useBootGate";
import { LIBRARY_SEARCH_FOCUS_EVENT } from "./hooks/useLibrarySearch";
import { WorkspaceLauncher } from "./launcher/WorkspaceLauncher";
import {
  createLeavingGuard,
  documentVersion,
  leavingAtRisk,
  shouldWarnBeforeLeaving,
} from "./session/leavingGuard";
import { isStandalone } from "./session/mode";
import { getSession, type ShareSession } from "./session/session";
import { useBeforeUnload } from "./session/useBeforeUnload";
import { useStorageLadder } from "./session/useStorageLadder";
import {
  friendlyWorkspaceName,
  readWorkspaceNames,
  rememberWorkspaceName,
} from "./session/workspaceName";
import { rememberWorkspace } from "./session/workspaceTransfer";
import { resolveBoardId, useCanvasStore } from "./store/useCanvasStore";
import { useUiStore } from "./store/useUiStore";
import { useWorkspaceSnapshot } from "./store/workspaceStore";
import { initTheme, useThemeStore } from "./theme/useThemeStore";

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
 * The workspace's own paint — the shell's style and the named rules — read from
 * the document meta. It re-renders only when that paint actually changes, so a
 * keystroke in a card never repaints the shell (ADR-0046 §3).
 */
function useWorkspacePaint(workspace: WorkspaceDocument): {
  shellStyle: SurfaceStyle | undefined;
  rules: StyleRule[];
} {
  const read = useCallback(
    () => ({ shellStyle: workspace.shellStyle(), rules: workspace.styleRules() }),
    [workspace],
  );
  const [paint, setPaint] = useState(read);
  const signature = useRef(JSON.stringify(paint));
  useEffect(() => {
    const sync = () => {
      const next = read();
      const key = JSON.stringify(next);
      if (key === signature.current) return;
      signature.current = key;
      setPaint(next);
    };
    sync();
    // The workspace's own paint is meta, not a snapshot section, so it has its
    // own subscription; the snapshot would never mention it.
    return workspace.observeWorkspacePaint(sync);
  }, [read, workspace]);
  return paint;
}

/**
 * The live role palette, read from the token layer on the shell root rather than
 * kept as a second copy (ADR-0046 §1). A theme change is exactly when it moves.
 */
function useSurfacePalette(root: RefObject<HTMLElement | null>, themeMode: string): SurfacePalette {
  const [palette, setPalette] = useState<SurfacePalette>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme mode is the trigger, not an input — the palette is read back from the DOM once the theme's classes have moved.
  useEffect(() => {
    const node = root.current;
    if (node) setPalette(readPalette(node));
  }, [root, themeMode]);
  return palette;
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

/**
 * The account surfaces pull in the Better Auth client. Loaded on demand for the
 * same reason as the share dialogs: a standalone build has no server and must not
 * ship a single byte of `/api/auth`, so the gate is a literal the bundler folds.
 */
const SignInSurface = lazy(async () => {
  const module = await import("./auth/SignInDialogHost");
  return { default: module.SignInDialogHost };
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
  const [workspaceName, setWorkspaceName] = useState(() => workspace.workspaceName());
  const connect = useCanvasStore((state) => state.connect);
  const provider = useCanvasStore((state) => state.provider);
  const presence = useCanvasStore((state) => state.presence);
  const status = useCanvasStore((state) => state.status);
  const ready = useCanvasStore((state) => state.ready);
  const synced = useCanvasStore((state) => state.synced);
  const boot = useBootGate(ready);
  const [leaving, setLeaving] = useState(false);
  const { screenToFlowPosition } = useReactFlow();
  const snapshot = useWorkspaceSnapshot();
  countRender("shell");

  // The shell paints from the workspace's own style, resolved with the named
  // rules (ADR-0046 §3–4). The variables are prefixed here because the shell
  // root is an ancestor of the board: an unprefixed `--paint-*` would be
  // inherited by cards that never named that edge.
  const shellRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const workspacePaint = useWorkspacePaint(workspace);
  const themeMode = useThemeStore((state) => state.mode);
  const palette = useSurfacePalette(shellRef, themeMode);
  const shellPaint = useMemo(
    () => shellPaintFor(workspacePaint.shellStyle, workspacePaint.rules, palette),
    [workspacePaint, palette],
  );
  const surfaceRules = useMemo(
    () => ({ rules: workspacePaint.rules, palette }),
    [workspacePaint.rules, palette],
  );

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
  const setMode = useUiStore((state) => state.setMode);
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
  const openBoardIds = useUiStore((state) => state.openBoardIds);
  const closeBoardTab = useUiStore((state) => state.closeBoardTab);
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
  const shareCardOpened = useRef(false);
  // A standalone build renders from IndexedDB alone: no socket, no presence and
  // no sharing, all decided once at build time.
  const standalone = isStandalone();

  // The account is read once by `SignInDialogHost`; the header and the storage
  // ladder only consume the answer. A device with no account is signed out, which
  // is where it already was — nothing about the local path changes (ADR-0067 §6).
  const signedIn = useAccountStore(accountSignedIn);
  const openSignIn = useAccountStore((state) => state.openSignIn);

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
      // A direct URL can create the first document without the launcher, so
      // the friendly default is applied here too; an existing name always wins.
      if (!workspace.hasWorkspaceName()) {
        workspace.renameWorkspace(friendlyWorkspaceName());
        setWorkspaceName(workspace.workspaceName());
      }
      // A workspace created from the launcher starts blank; older workspaces
      // keep the two-card demo they were seeded with.
      const fresh = new URLSearchParams(window.location.search).get("fresh") === "1";
      if (!fresh && workspace.listCards().length === 0) {
        // Connector ids are derived from the card id, not random. Two clients
        // opening the same new workspace both seed it; the cards carry fixed ids
        // and converge, so random dot ids would union into eight connectors on
        // one card instead of four.
        const starters = (cardId: string) =>
          defaultConnectors().map((connector, index) => ({
            ...connector,
            id: `${cardId}-connector-${index + 1}`,
          }));
        workspace.createCard({
          id: "starter-1",
          boardId: board.id,
          position: { x: 0, y: 0 },
          connectors: starters("starter-1"),
        });
        // One card width plus a gap, so the two starters read as two cards and a
        // section drawn around the first does not reach into the second.
        workspace.createCard({
          id: "starter-2",
          boardId: board.id,
          position: { x: DEFAULT_CARD_WIDTH + 192, y: 0 },
          connectors: starters("starter-2"),
        });
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

  // The leave guard ([ADR-0025](../../docs/decisions/0025-client-durability-and-offline-scope.md)
  // amendment). `banner` is the ladder's own answer — anonymous, and no promise
  // that this browser will keep the copy — so it is the only condition here.
  // Whether *another* device is in the room right now, which is what lets the ladder
  // stay quiet while two people work: a warning about this device's storage is noise
  // once a second copy exists (author's note, ADR-0025 amendment). A socket of our
  // own is not enough — a single reader alone in a workspace is still the only copy.
  const inRoom = !standalone && peerCount > 0;
  const ladder = useStorageLadder(signedIn, inRoom);
  const leavingGuard = useRef(createLeavingGuard());
  // Set synchronously by a navigation the reader chose, so the native prompt does
  // not ask again during the unload that gesture just started.
  const leavingStarted = useRef(false);
  const [leavingPrompt, setLeavingPrompt] = useState(false);
  // A share is someone else's work: this browser holds a projection, not the only copy.
  const leavingAtOwnRisk = share === null && leavingAtRisk(ladder);

  useBeforeUnload(leavingAtOwnRisk && !leaving, () => !leavingStarted.current);

  const goHome = useCallback(() => {
    if (leaving) return;
    leavingStarted.current = true;
    if (prefersReducedMotion()) {
      window.location.assign("/");
      return;
    }
    setLeaving(true);
    window.setTimeout(() => window.location.assign("/"), 180);
  }, [leaving]);

  /** Every path back to the launcher comes through here, so no route skips the guard. */
  const requestLeave = useCallback(() => {
    if (leaving || leavingPrompt) return;
    const version = documentVersion(workspace.doc);
    if (
      shouldWarnBeforeLeaving({
        ladder,
        guard: leavingGuard.current,
        version,
        applicable: share === null,
      })
    ) {
      setLeavingPrompt(true);
      return;
    }
    goHome();
  }, [leaving, leavingPrompt, ladder, workspace, share, goHome]);

  // Being told is the point, so closing the dialog is an answer: the next leave
  // stays quiet until the work changes.
  const dismissLeavePrompt = useCallback(() => {
    leavingGuard.current.dismiss(documentVersion(workspace.doc));
    setLeavingPrompt(false);
  }, [workspace]);

  const leaveAnyway = useCallback(() => {
    dismissLeavePrompt();
    goHome();
  }, [dismissLeavePrompt, goHome]);

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
   * What a purpose opens when it is entered: a run starts from a selection made in
   * the library (ADR-0064 §8), a record starts from its tutorial card. The
   * previous value is a ref so a callback that changes identity cannot hand the
   * reader a second library or a second card; the purpose itself is the trigger.
   *
   * Leaving the mode puts back what entering it added, and only if the mode added
   * it: a drawer opened by hand is the reader's, so a mode change must not close it.
   */
  const previousPurpose = useRef<CanvasPurpose>(purpose);
  useEffect(() => {
    if (previousPurpose.current === purpose) return;
    const left = previousPurpose.current;
    previousPurpose.current = purpose;
    // Only when the drawer was not already there: a library the reader had open is
    // the reader's, not the new mode's.
    if (purpose === "run" && !useUiStore.getState().libraryOpen) setLibraryOpen(true, "mode");
    if (purpose === "record") startRecording();
    if (left === "run" && useUiStore.getState().libraryReason === "mode") setLibraryOpen(false);
  }, [purpose, setLibraryOpen, startRecording]);

  /** A run is carried out by one engine, shared with the canvas and the library. */
  const placementRun = usePlacementEngine();
  // Subscribed, not read at render time: a row's Place verb changes with it.
  const placementRunActive = usePlacementRunStore((state) => state.run !== null);

  // A run places into the board in front of the reader. Navigating away cancels it
  // rather than continuing into a board they are no longer looking at (ADR-0063 §9).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the board is the trigger; the store call needs no dependency of its own.
  useEffect(() => {
    usePlacementRunStore.getState().finishAll();
  }, [activeBoardId]);

  /**
   * The run verbs: "Thread cards", "Web cards", "Pattern cards", "Place cards".
   * The verb *is* the mode, so choosing one sets the mode and starts the run — two
   * things a user should not have to do separately.
   */
  const runCards = useCallback(
    (cardIds: readonly string[], runMode: CanvasMode, source: PlacementSource) => {
      if (!canEditLayout || cardIds.length === 0) return;
      setMode(runMode);
      placementRun.start(cardIds, source);
    },
    [canEditLayout, placementRun, setMode],
  );

  /**
   * Start a picker loop: one card now, and every later pick joins the same
   * sequence. The loop is the only run that outlives its queue, because it is
   * waiting to be fed (ADR-0063 §6).
   */
  const startPlacementLoop = useCallback(
    (cardIds: readonly string[]) => {
      if (!canEditLayout || cardIds.length === 0) return;
      const [first, ...rest] = cardIds;
      if (!first) return;
      usePlacementRunStore.getState().start([first], { source: "picker" });
      // The rest are queued behind the first, so a selection can seed the loop and
      // still be added to by hand afterwards.
      if (rest.length > 0) usePlacementRunStore.getState().enqueue(rest);
      placementRun.step();
    },
    [canEditLayout, placementRun],
  );

  /**
   * A dock pick during a run joins the run instead of landing at a fixed point: the
   * card is created unplaced and queued, which is the "pick, place, pick again"
   * loop from the add-card side (ADR-0063 §6).
   */
  const createCardInRun = useCallback(
    (typeId: string) => {
      if (!activeBoardId) return;
      const running = usePlacementRunStore.getState().run;
      if (!running) {
        createCard(typeId);
        return;
      }
      const card = workspace.createCard({ typeId });
      usePlacementRunStore.getState().enqueue([card.id]);
      placementRun.step();
    },
    [activeBoardId, createCard, placementRun, workspace],
  );

  /**
   * Dock-created portals land at the viewport centre, centred on the pointer
   * the way a placed card is. The card and its target are one commit.
   */
  const createPortal = useCallback(
    (targetBoardId: string) => {
      if (!activeBoardId || !canCreateContent) return;
      const centre = canvasPoint();
      const card = workspace.createPortalCard({
        boardId: activeBoardId,
        targetBoardId,
        position: {
          x: centre.x - DEFAULT_PORTAL_SIZE.width / 2,
          y: centre.y - DEFAULT_PORTAL_SIZE.height / 2,
        },
      });
      setSelectedNodeIds([card.id]);
    },
    [activeBoardId, canvasPoint, workspace, canCreateContent, setSelectedNodeIds],
  );

  /**
   * The palette's entries, built from the command registry. Navigation and
   * creation are wired to the same store actions and helpers the shell already
   * uses, so the palette cannot drift from the controls it duplicates.
   */
  const paletteItems = useMemo(() => {
    const capabilities: Capability[] = [];
    if (canEditContent) capabilities.push("canEditContent");
    if (canEditLayout) capabilities.push("canEditLayout");
    if (canPublish) capabilities.push("canPublish");
    if (canCreateContent) capabilities.push("canCreateContent");
    if (canCreateBoards) capabilities.push("canCreateBoards");
    if (canManageBoards) capabilities.push("canManageBoards");
    if (canManageSchema) capabilities.push("canManageSchema");
    if (canManageTrash) capabilities.push("canManageTrash");
    if (canManageLinks) capabilities.push("canManageLinks");

    const targetCardId = cardFocusId ?? inspectorNodeId ?? selectedNodeIds[0] ?? null;
    const cardPlaced =
      targetCardId !== null &&
      activeBoardId !== null &&
      workspace
        .listCardPlacements(targetCardId)
        .some((placement) => placement.boardId === activeBoardId);

    return buildPaletteItems({
      capabilities,
      state: {
        workspaceSurface,
        readOnly,
        paletteOpen,
        libraryOpen,
        libraryTab,
        activeBoardId,
        activeViewId,
        cardId: targetCardId,
        cardPlaced,
        boards: snapshot.boards.map((board) => ({ id: board.id, name: board.name })),
        views: savedViews.map((view) => ({ id: view.id, name: view.name })),
        sections: snapshot.sections.map((section) => ({
          id: section.id,
          boardId: section.boardId,
          title: section.title,
        })),
        cards: snapshot.cards.map((card) => {
          const type = workspace.getType(card.primaryTypeId);
          return {
            id: card.id,
            title: workspace.displayTitle(card.id),
            typeName: type?.name ?? "Card",
          };
        }),
        types: snapshot.types.map((type) => ({ id: type.id, name: type.name })),
        trashedCount: workspace.listTrashedCards().length,
      },
      actions: {
        openPalette: () => setPaletteOpen(true),
        openLibrary: () => setLibraryOpen(true),
        openLibraryTab: (tab) => {
          setLibraryTab(tab);
          setLibraryOpen(true);
        },
        searchLibrary: () => {
          setLibraryTab("cards");
          setLibraryOpen(true);
        },
        goToBoard: (boardId) => activateBoard(boardId),
        goToSection: (sectionId) => {
          const section = workspace.getSection(sectionId);
          if (!section) return;
          activateBoard(section.boardId);
          selectSection(section.id);
        },
        focusCard: (cardId) => openCardFocus(cardId),
        openCard: (cardId) => openInspector(cardId),
        applyView: (viewId) => {
          const view = workspace.getView(viewId);
          if (view) applyView(view.id, view.query);
        },
        exitView: () => exitView(),
        createCard: (typeId) => createCard(typeId),
        createCardInInbox: () => {
          workspace.createCard();
        },
        createSketch: () => {
          const whiteboard = ensureWhiteboardType(workspace);
          createCard(whiteboard.id);
        },
        createSection: () => {
          if (!activeBoardId) return;
          const centre = canvasPoint();
          workspace.createSection({ boardId: activeBoardId, x: centre.x - 180, y: centre.y - 130 });
        },
        createBoard: () => {
          const board = workspace.createBoard();
          activateBoard(board.id);
        },
        editCard: (cardId) => openCardFocus(cardId),
        // "Set type" means "make this the primary": a card that carries several
        // types must not lose the others because a palette row was picked
        // ([ADR-0053](../../docs/decisions/0053-supertags-are-multi-type.md)).
        setCardType: (cardId, typeId) => workspace.setPrimaryType(cardId, typeId),
        trashCard: (cardId) => workspace.trashCard(cardId),
        restoreCard: (cardId) => workspace.restoreCard(cardId),
        deleteCardForever: (cardId) => workspace.purgeCard(cardId),
        emptyTrash: () => workspace.emptyTrash(),
        duplicateCard: (cardId) => {
          workspace.duplicateCard(cardId, activeBoardId ? { boardId: activeBoardId } : {});
        },
        removeFromBoard: (cardId) => {
          if (activeBoardId) workspace.unplaceCard(activeBoardId, cardId);
        },
        placeCard: (cardId) => placeCard(cardId),
        openTypes: () => openTypeSettings(),
        openShare: () => requestShare("workspace"),
        toggleTheme: () => setThemeMode(themeMode === "dark" ? "light" : "dark"),
      },
    });
  }, [
    snapshot.boards,
    snapshot.cards,
    snapshot.types,
    snapshot.sections,
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
  ]);

  /**
   * A new sketch, placed where the dock's card would land and opened in the
   * focus surface — the same result as the canvas's own "New sketch" menu item.
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

  const activeBoardName = snapshot.boards.find((board) => board.id === activeBoardId)?.name ?? null;
  // The canvas behind the cards is a surface of its own (ADR-0051 §1), so the
  // board's style paints it. React Flow's own layer reads --xy-background-color,
  // which is what lets the paint reach it without the canvas knowing about styles.
  const boardPaint = useMemo((): Record<string, string> => {
    const board = snapshot.boards.find((entry) => entry.id === activeBoardId);
    if (!board?.style) return {};
    const paint = surfacePaintVars(resolveSurfaceStyle(board.style, "board"));
    return { ...paint, "--xy-background-color": "var(--paint-surface)" };
  }, [snapshot.boards, activeBoardId]);
  const boardPainted = Object.keys(boardPaint).length > 0;
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

  // The tab strip shows the open boards; the library shows every board.
  const openBoards = useMemo(
    () => snapshot.boards.filter((board) => openBoardIds.includes(board.id)),
    [snapshot.boards, openBoardIds],
  );

  /**
   * The library's Boards section. Placing a board adds a portal to the active
   * board and leaves this list alone: boards are global, so a placed board is
   * still one row here (unlike a card, which leaves the inbox).
   */
  const boardEntries = useMemo<LibraryBoard[]>(() => {
    const liveCards = new Set(
      snapshot.cards.filter((card) => !card.deletedAt).map((card) => card.id),
    );
    const placed = new Map<string, number>();
    for (const placement of snapshot.placements) {
      if (!liveCards.has(placement.cardId)) continue;
      placed.set(placement.boardId, (placed.get(placement.boardId) ?? 0) + 1);
    }
    return snapshot.boards.map((board) => ({
      id: board.id,
      title: board.name,
      open: openBoardIds.includes(board.id),
      cardCount: placed.get(board.id) ?? 0,
      template: board.template === true,
    }));
  }, [snapshot.boards, snapshot.cards, snapshot.placements, openBoardIds]);

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
   * Delete asks once, in the library, and then closes the tab: a deleted board
   * must not leave a dangling id in the open set.
   */
  const deleteBoard = useCallback(
    (boardId: string, cards: "keep" | "trash") => {
      if (!canManageBoards) return;
      workspace.deleteBoard(boardId, { cards });
      closeBoardTab(boardId);
    },
    [canManageBoards, workspace, closeBoardTab],
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
    <SurfaceRulesContext.Provider value={surfaceRules}>
      <div
        ref={shellRef}
        className="app-canvas flex h-screen w-screen flex-col"
        data-ready={ready && synced}
        data-leaving={leaving ? "true" : undefined}
        // The shell's own paint: present only when the workspace names a style,
        // so an unstyled workspace renders exactly as it did before the rules.
        data-shell-paint={shellPaint.fields || undefined}
        style={shellPaint.vars as CSSProperties}
      >
        <TitleBar
          onNavigateHome={requestLeave}
          onOpenSearch={() => setPaletteOpen(true)}
          // A standalone build never opens a socket, so "Syncing" would be a lie;
          // the status slot reports the connection it has (none) beside the note.
          status={standalone ? "disconnected" : status}
          {...(share ? { role: share.role } : {})}
          peerCount={standalone ? 0 : peerCount}
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
                <Suspense fallback={null}>
                  <WorkspaceActions
                    workspaceId={workspaceId}
                    boardId={activeBoardId}
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
          <CardFocusHost />
          <TourOverlayHost />
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
              placementRun.step();
            }}
            onRunLoop={(cardIds) => startPlacementLoop(cardIds)}
            runActive={placementRunActive}
            canManageTrash={canManageTrash}
          />
        ) : null}

        {/* The account surfaces: sign-in, and the admission panel while an account waits. */}
        {standalone ? null : (
          <Suspense fallback={null}>
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

        <PerfOverlay />
      </div>
    </SurfaceRulesContext.Provider>
  );
}
