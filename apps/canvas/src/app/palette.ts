import type { SavedView, WorkspaceDocument } from "@suite/graph";
import { DEFAULT_PORTAL_SIZE } from "../canvas/PortalCard";
import { ensureWhiteboardType } from "../cards/whiteboard";
import type { Capability } from "../command/commandRegistry";
import { buildPaletteItems } from "../command/paletteProviders";
import type { PaletteItem } from "../command/paletteRank";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import type { useUiStore } from "../store/useUiStore";

type UiState = ReturnType<typeof useUiStore.getState>;

export interface ShellPaletteArgs {
  workspace: WorkspaceDocument;
  snapshot: WorkspaceSnapshot;
  savedViews: SavedView[];
  activeBoardId: string | null;
  activeViewId: string | null;
  cardFocusId: string | null;
  inspectorNodeId: string | null;
  selectedNodeIds: string[];
  workspaceSurface: boolean;
  readOnly: boolean;
  paletteOpen: boolean;
  libraryOpen: boolean;
  libraryTab: UiState["libraryTab"];
  canEditContent: boolean;
  canEditLayout: boolean;
  canPublish: boolean;
  canCreateContent: boolean;
  canCreateBoards: boolean;
  canManageBoards: boolean;
  canManageSchema: boolean;
  canManageTrash: boolean;
  canManageLinks: boolean;
  activateBoard: UiState["activateBoard"];
  selectSection: UiState["selectSection"];
  openCardFocus: UiState["openCardFocus"];
  openInspector: UiState["openInspector"];
  applyView: UiState["applyView"];
  exitView: UiState["exitView"];
  createCard: (typeId: string) => string | undefined;
  canvasPoint: () => { x: number; y: number };
  placeCard: (cardId: string) => void;
  setLibraryOpen: UiState["setLibraryOpen"];
  setPaletteOpen: UiState["setPaletteOpen"];
  setLibraryTab: UiState["setLibraryTab"];
  openTypeSettings: UiState["openTypeSettings"];
  requestShare: UiState["requestShare"];
  setThemeMode: (mode: "light" | "dark") => void;
  themeMode: string;
}

/** The palette rows for the shell. Pure: every effect arrives as a callback. */
export function shellPaletteItems(args: ShellPaletteArgs): PaletteItem[] {
  const {
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
  } = args;

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
      // `portal.create` expands to one row per other board, and each row needs
      // this handler: without it the registry hides the rows, because a portal
      // cannot be created without a target. The card and its target land in one
      // commit, centred on the viewport the reader is looking at.
      createPortalOnBoard: (targetBoardId) => {
        if (!activeBoardId) return;
        const centre = canvasPoint();
        workspace.createPortalCard({
          boardId: activeBoardId,
          targetBoardId,
          position: {
            x: centre.x - DEFAULT_PORTAL_SIZE.width / 2,
            y: centre.y - DEFAULT_PORTAL_SIZE.height / 2,
          },
        });
      },
      createBoard: () => {
        const board = workspace.createBoard();
        activateBoard(board.id);
      },
      editCard: (cardId) => openCardFocus(cardId),
      // "Set type" means "make this the primary": a card that carries several
      // types must not lose the others because a palette row was picked
      // (ADR-0053).
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
}
