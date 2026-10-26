import type { ViewQuery } from "@suite/graph";
import { create } from "zustand";
import type { CanvasMode } from "../canvas/linkGesture";
import { usePlacementRunStore } from "../canvas/placementRun";
import { DEFAULT_PLACEMENT_OPTIONS, type PlacementOptions } from "../canvas/placeRun";
import type { CanvasPurpose } from "../canvas/purpose";
import { useRecordRunStore } from "../canvas/recordRun";
import { getSession, type SessionCapabilities, sessionCapabilities } from "../session/session";
import type { ShareScope } from "../session/shares";

export interface ContextMenuState {
  x: number;
  y: number;
  kind: "canvas" | "node" | "connector" | "edge" | "section";
  nodeId?: string;
  connectorId?: string;
  edgeId?: string;
  sectionId?: string;
  flowPosition?: { x: number; y: number };
}

export interface SelectedConnector {
  nodeId: string;
  connectorId: string;
}

export type LibraryTab = "inbox" | "cards" | "boards" | "trash";

/**
 * Who asked for the library. `mode` means a mode opened it as its own starting
 * point, so leaving that mode closes it again; `reader` is a drawer the person
 * opened and only the person closes.
 */
export type LibraryReason = "reader" | "mode";

/** Adds a board to the tab strip unless it is already there. */
function withOpenBoard(openBoardIds: string[], boardId: string): string[] {
  return openBoardIds.includes(boardId) ? openBoardIds : [...openBoardIds, boardId];
}

/**
 * Which editor of one card holds the keystrokes; only one may be editable at a
 * time. `focus` is the full-canvas card surface, which owns the body editor the
 * same way the inspector's `panel` does.
 */
/** What the container panel is looking at: a section, or a portal standing for a board. */
export interface ContainerInspectorTarget {
  kind: "section" | "portal";
  id: string;
}

/**
 * A tour being read or authored ([ADR-0058](../../../docs/decisions/0058-a-tour-is-one-document-on-three-surfaces.md)).
 *
 * The steps themselves are content on the tutorial card; this is only what one
 * reader is looking at — the same split as `containerInspector` or a selection.
 * `presenting` is what makes the overlay appear; `panelOpen` lets the author
 * keep the controls beside the spotlight while it does.
 */
export interface TourState {
  /** The tutorial card being played. */
  tutorialId: string;
  /** Index of the step showing; clamped by the panel, which knows the count. */
  stepIndex: number;
  presenting: boolean;
  /** Whether the inspector keeps its controls on screen while presenting. */
  panelOpen: boolean;
}

export type EditingSurface = "canvas" | "panel" | "focus";

/** React Flow's viewport: world-to-screen translate plus zoom. */
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

/** A board the user left, with the viewport that returns to it exactly. */
export interface BoardVisit {
  boardId: string;
  viewport: ViewportState;
  /**
   * How the board was entered. A portal visit can also be left by zooming out;
   * a tab switch is only undone by Escape or the back control.
   */
  via: "portal" | "manual";
}

/** Screen rectangle of a portal node, in window coordinates. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A portal the user activated; the canvas draws the camera transition for it. */
export interface PortalEntryRequest {
  nodeId: string;
  targetBoardId: string;
  rect: ScreenRect;
}

/** Library scope: the whole workspace, or the cards placed on the active board. */
export type LibraryScope = "all" | "board";

export interface FocusTarget {
  kind: "card" | "section";
  id: string;
  boardId: string;
  /**
   * Bumped on every request so focusing the same object twice still moves the
   * viewport; consumers key their effect on it.
   */
  nonce: number;
}

let focusNonce = 0;

const nextFocusTarget = (kind: FocusTarget["kind"], id: string, boardId: string): FocusTarget => {
  focusNonce += 1;
  return { kind, id, boardId, nonce: focusNonce };
};

/** One camera instruction per board switch; the canvas consumes it once. */
let navigationNonce = 0;
const nextNavigationNonce = () => {
  navigationNonce += 1;
  return navigationNonce;
};

interface UiState extends SessionCapabilities {
  /** Board currently on screen; null until the shell resolves one. */
  activeBoardId: string | null;
  /**
   * Boards with an open tab, in the order they were opened. A tab is a view of
   * a board, not a claim on it: closing one leaves the board in the library and
   * never writes the document.
   */
  openBoardIds: string[];
  /** Viewport last seen on each board, so a return lands where it left. */
  boardViewports: Record<string, ViewportState>;
  /** Boards visited from the current one, newest last. */
  boardHistory: BoardVisit[];
  /**
   * A one-shot instruction to move the camera after a board switch; `viewport`
   * null means "fit the board's content".
   */
  viewportRequest: { boardId: string; viewport: ViewportState | null; nonce: number } | null;
  /** A portal entry waiting for the camera transition to play. */
  portalEntry: PortalEntryRequest | null;
  /** Card shown on the full-canvas focus surface, if any. */
  cardFocusId: string | null;
  /**
   * Viewer shorthand; capability flags remain the gate for every write path.
   * It is UI state (not read from the session in each component) so tests and
   * stories can render a read-only surface without a `?share=` URL. Editor
   * shares keep `readOnly` false while their capability flags decide what they
   * may create, publish, trash or manage.
   */
  readOnly: boolean;
  setReadOnly: (readOnly: boolean) => void;
  /** Tests and stories override the capability matrix derived from the session. */
  setCapabilities: (capabilities: Partial<SessionCapabilities>) => void;
  libraryOpen: boolean;
  /**
   * Who asked for the drawer. A library the *mode* opened (`run` needs a queue) is
   * the mode's to close; one the reader opened is theirs, and leaving a mode must
   * not shut a drawer they asked for.
   */
  libraryReason: LibraryReason;
  libraryTab: LibraryTab;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  /**
   * A card being dragged out of the library, in *screen* units. The drawer owns
   * the gesture; the canvas owns the camera, so it converts this to flow space
   * before publishing presence.
   */
  libraryDrag: { cardId: string; screen: { x: number; y: number } } | null;
  setLibraryDrag: (drag: { cardId: string; screen: { x: number; y: number } } | null) => void;
  /**
   * A link end waiting for a connector to be clicked. The link inspector arms
   * this so an end can be moved without dragging on the canvas; the next
   * connector press re-attaches it and clears the field.
   */
  linkEndMove: { edgeId: string; end: "source" | "target" } | null;
  startLinkEndMove: (move: { edgeId: string; end: "source" | "target" }) => void;
  cancelLinkEndMove: () => void;
  /** Section selected on the active board, if any. */
  selectedSectionId: string | null;
  /**
   * The container whose panel is open: a section, or the portal card that stands
   * for a board. Containers are read by their own panel — they have no fields, no
   * types and no body, so the card inspector is the wrong surface for them.
   */
  containerInspector: ContainerInspectorTarget | null;
  /** The tour this reader is in, if any (ADR-0058). */
  tour: TourState | null;
  /** Section whose title input is open for renaming. */
  editingSectionId: string | null;
  editingNodeId: string | null;
  /** Which editor on the card has focus; titles come first for new cards. */
  editingField: "title" | "body";
  editingSurface: EditingSurface;
  /** Card or section a surface asked to reveal; consumed once by the canvas. */
  focusTarget: FocusTarget | null;
  /** Card whose inspector panel is open, if any. */
  inspectorNodeId: string | null;
  /** Field the panel was asked to reveal, so a link can land on it. */
  inspectorFieldId: string | null;
  /** Cards whose frontmatter is expanded on the canvas. Local UI state only. */
  expandedCardMeta: Record<string, boolean>;
  /** Type registry editor, opened from the dock or the inspector. */
  typeSettingsOpen: boolean;
  /** Facet filters for the library drawer; OR within a group, AND across. */
  libraryTypeFilter: string[];
  libraryTagFilter: string[];
  /** Sections facet of the board-scoped library; selecting one includes its subtree. */
  librarySectionFilter: string[];
  libraryScope: LibraryScope;
  /**
   * The drawer is taking the whole window rather than floating above the dock.
   * A library with sections for cards, sketches, boards and types is a browser,
   * and browsing wants room; the floating drawer stays the default because it
   * lets a row be dragged onto the canvas beside it.
   */
  libraryFull: boolean;
  setLibraryFull: (full: boolean) => void;
  /**
   * What the canvas is for ([ADR-0064](../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)).
   * The second axis, beside `mode`: `mode` says what the next click does, `purpose`
   * says what the reader is doing at all. Always exactly one, because the control
   * cycles and because two purposes both claiming the next click is how a canvas
   * ends up placing a card into a tour.
   */
  purpose: CanvasPurpose;
  /**
   * Choose a purpose the reader may choose, and carry out what it implies:
   * leaving `run` ends the run, and leaving `present` stops the takeover.
   *
   * `present` is refused, always. A presentation is scoped to a tour, so only a
   * tour can put the reader in one — the widget can show the state and get out of
   * it, never select it (ADR-0064 §11).
   */
  setPurpose: (purpose: CanvasPurpose) => void;
  /**
   * The numbers a placement run reads: gap, columns, ring radius, section padding
   * ([ADR-0056](../../docs/decisions/0056-card-settings-owns-defaults.md) amendment).
   * They live in UI state because Card Settings — the surface that will own them —
   * is A33; when it lands it writes these same fields rather than a second copy.
   */
  placementOptions: PlacementOptions;
  setPlacementOptions: (options: Partial<PlacementOptions>) => void;
  libraryGroupBySection: boolean;
  /** Saved query view applied to the library, if any. */
  activeViewId: string | null;
  /**
   * Live text of the library search box. The drawer owns the box and mirrors
   * it here so the app bar can offer "save current search" without reaching
   * into another component's state.
   */
  libraryQuery: string;
  setLibraryQuery: (query: string) => void;
  /**
   * Applies a saved view to the same controls manual facets use — there is no
   * second filtering model, just a stored query copied into them.
   */
  applyView: (viewId: string, query: ViewQuery) => void;
  /** Drops the saved view and everything it filled in. */
  exitView: () => void;
  /** Whether the board outline rail is expanded. */
  outlineOpen: boolean;
  /** The command palette: one surface for navigation and actions from `⌘K`. */
  paletteOpen: boolean;
  /**
   * What a plain click on a connector starts. `connect` drags one link;
   * `thread` keeps the chain going. Shift-click chains in either mode, which is
   * the gesture people already know from other tools.
   */
  mode: CanvasMode;
  setMode: (mode: CanvasMode) => void;
  contextMenu: ContextMenuState | null;
  selectedConnector: SelectedConnector | null;
  /** Scope a canvas gesture asked the app-bar dialog to open on; consumed once. */
  shareRequest: ShareScope | null;
  requestShare: (scope: ShareScope) => void;
  clearShareRequest: () => void;
  setActiveBoardId: (id: string | null) => void;
  /**
   * Drops a board's tab. Nothing else happens: no prompt, no write, no
   * unplace — the board stays in the library and its cards stay where they are.
   */
  closeBoardTab: (boardId: string) => void;
  /**
   * Switches boards and remembers where the user came from. Tab clicks, the
   * library's "go to board" and a finished portal transition all use it, so a
   * back stack exists for every path into another board.
   */
  activateBoard: (
    boardId: string,
    options?: { via?: BoardVisit["via"]; viewport?: ViewportState | null },
  ) => void;
  /** Returns to the previous board and viewport; false when there is nowhere to go. */
  goBackBoard: () => boolean;
  recordBoardViewport: (boardId: string, viewport: ViewportState) => void;
  clearViewportRequest: () => void;
  requestPortalEntry: (request: PortalEntryRequest) => void;
  clearPortalEntry: () => void;
  openCardFocus: (cardId: string) => void;
  closeCardFocus: () => void;
  setLibraryOpen: (open: boolean, reason?: LibraryReason) => void;
  setLibraryTab: (tab: LibraryTab) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  selectSection: (id: string | null) => void;
  openContainerInspector: (target: ContainerInspectorTarget) => void;
  closeContainerInspector: () => void;
  /** Opens a tutorial's panel without playing it. */
  openTour: (tutorialId: string) => void;
  /** Starts (or resumes) playback from a step. */
  presentTour: (tutorialId: string, stepIndex?: number) => void;
  setTourStep: (stepIndex: number) => void;
  setTourPanelOpen: (open: boolean) => void;
  /** Leaves the tour entirely: closes the panel and the overlay. */
  closeTour: () => void;
  /**
   * A surface asked to step through a portal. The camera owns the doorway — it
   * needs the node's screen rect to fly from — so the panel only names the board
   * and the canvas performs the entry.
   */
  portalOpenRequest: { cardId: string; boardId: string; at: number } | null;
  requestPortalOpen: (cardId: string, boardId: string) => void;
  clearPortalOpenRequest: () => void;
  setEditingSection: (id: string | null) => void;
  setSelectedConnector: (connector: SelectedConnector | null) => void;
  startEditing: (id: string, field?: "title" | "body", surface?: EditingSurface) => void;
  stopEditing: () => void;
  setEditingField: (field: "title" | "body") => void;
  setEditingSurface: (surface: EditingSurface) => void;
  focusCard: (cardId: string, boardId: string) => void;
  focusSection: (sectionId: string, boardId: string) => void;
  clearFocusTarget: () => void;
  /** Replaces the selection with every card on the board; the inspector is untouched. */
  selectAllOnBoard: (ids: string[]) => void;
  openInspector: (id: string, fieldId?: string | null) => void;
  closeInspector: () => void;
  toggleCardMeta: (id: string) => void;
  openTypeSettings: () => void;
  /** The command palette: one surface for navigation and actions from `⌘K`. */
  setPaletteOpen: (open: boolean) => void;
  closeTypeSettings: () => void;
  toggleLibraryType: (id: string) => void;
  toggleLibraryTag: (id: string) => void;
  toggleLibrarySection: (id: string) => void;
  clearLibraryFilters: () => void;
  setLibraryScope: (scope: LibraryScope) => void;
  toggleLibraryGroupBySection: () => void;
  toggleOutline: () => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  ...sessionCapabilities(getSession()),
  activeBoardId: null,
  openBoardIds: [],
  boardViewports: {},
  boardHistory: [],
  viewportRequest: null,
  portalEntry: null,
  cardFocusId: null,
  readOnly: getSession().readOnly,
  setReadOnly: (readOnly) => set({ readOnly }),
  setCapabilities: (capabilities) => set(capabilities),
  libraryOpen: false,
  libraryReason: "reader",
  libraryTab: "inbox",
  selectedNodeIds: [],
  selectedEdgeIds: [],
  selectedSectionId: null,
  containerInspector: null,
  tour: null,
  portalOpenRequest: null,
  libraryDrag: null,
  linkEndMove: null,
  editingSectionId: null,
  editingNodeId: null,
  editingField: "body",
  editingSurface: "canvas",
  focusTarget: null,
  inspectorNodeId: null,
  inspectorFieldId: null,
  expandedCardMeta: {},
  typeSettingsOpen: false,
  paletteOpen: false,
  mode: "place",
  libraryTypeFilter: [],
  libraryTagFilter: [],
  librarySectionFilter: [],
  libraryScope: "all",
  libraryFull: false,
  placementOptions: DEFAULT_PLACEMENT_OPTIONS,
  purpose: "explore",
  libraryGroupBySection: false,
  activeViewId: null,
  libraryQuery: "",
  outlineOpen: true,
  contextMenu: null,
  selectedConnector: null,
  shareRequest: null,
  requestShare: (shareRequest) => set({ shareRequest }),
  clearShareRequest: () => set({ shareRequest: null }),
  setActiveBoardId: (activeBoardId) =>
    set((state) => ({
      activeBoardId,
      openBoardIds: activeBoardId
        ? withOpenBoard(state.openBoardIds, activeBoardId)
        : state.openBoardIds,
    })),
  closeBoardTab: (boardId) =>
    set((state) => {
      const openBoardIds = state.openBoardIds.filter((id) => id !== boardId);
      if (state.activeBoardId !== boardId) return { openBoardIds };
      // The closed tab was the one on screen, so the last remaining tab takes
      // over. With none left the shell resolves a board again on the next pass.
      const next = openBoardIds.at(-1) ?? null;
      return {
        openBoardIds,
        activeBoardId: next,
        ...(next
          ? {
              viewportRequest: {
                boardId: next,
                viewport: state.boardViewports[next] ?? null,
                nonce: nextNavigationNonce(),
              },
            }
          : {}),
        editingNodeId: null,
        editingSectionId: null,
        selectedSectionId: null,
        selectedNodeIds: [],
        selectedEdgeIds: [],
        selectedConnector: null,
        cardFocusId: null,
      };
    }),
  activateBoard: (boardId, options = {}) =>
    set((state) => {
      if (state.activeBoardId === boardId) {
        const openBoardIds = withOpenBoard(state.openBoardIds, boardId);
        return openBoardIds === state.openBoardIds ? state : { openBoardIds };
      }
      const from = state.activeBoardId;
      const leaving = from
        ? [
            {
              boardId: from,
              viewport: state.boardViewports[from] ?? { x: 0, y: 0, zoom: 1 },
              via: options.via ?? ("manual" as const),
            },
          ]
        : [];
      const request =
        options.viewport !== undefined ? options.viewport : (state.boardViewports[boardId] ?? null);
      return {
        activeBoardId: boardId,
        // A switcher, a portal and the library all land here, so every one of
        // them gives the board a tab.
        openBoardIds: withOpenBoard(state.openBoardIds, boardId),
        // Bounded: a long portal chain should not grow the session forever.
        boardHistory: [...state.boardHistory, ...leaving].slice(-24),
        viewportRequest: { boardId, viewport: request, nonce: nextNavigationNonce() },
        // Editing, focus and a marquee belong to the board that left the screen.
        editingNodeId: null,
        editingSurface: "canvas" as EditingSurface,
        editingSectionId: null,
        selectedSectionId: null,
        // A card selection is also board-scoped; entering a portal starts clean.
        selectedNodeIds: options.via === "portal" ? [] : state.selectedNodeIds,
        selectedEdgeIds: [],
        selectedConnector: null,
        cardFocusId: null,
      };
    }),
  goBackBoard: () => {
    const state = get();
    const previous = state.boardHistory.at(-1);
    if (!previous) return false;
    set({
      activeBoardId: previous.boardId,
      openBoardIds: withOpenBoard(state.openBoardIds, previous.boardId),
      boardHistory: state.boardHistory.slice(0, -1),
      viewportRequest: {
        boardId: previous.boardId,
        viewport: previous.viewport,
        nonce: nextNavigationNonce(),
      },
      editingNodeId: null,
      editingSurface: "canvas" as EditingSurface,
      editingSectionId: null,
      selectedSectionId: null,
      selectedNodeIds: [],
      selectedEdgeIds: [],
      selectedConnector: null,
      cardFocusId: null,
    });
    return true;
  },
  recordBoardViewport: (boardId, viewport) =>
    set((state) => {
      const current = state.boardViewports[boardId];
      if (
        current &&
        current.x === viewport.x &&
        current.y === viewport.y &&
        current.zoom === viewport.zoom
      ) {
        return state;
      }
      return { boardViewports: { ...state.boardViewports, [boardId]: viewport } };
    }),
  clearViewportRequest: () => set({ viewportRequest: null }),
  requestPortalEntry: (request) =>
    // One transition at a time: a second activation during the animation would
    // stack overlays and write a second board switch.
    set((state) => (state.portalEntry ? state : { portalEntry: request })),
  clearPortalEntry: () => set({ portalEntry: null }),
  openCardFocus: (cardFocusId) =>
    // Focus owns the canvas: the drawer would duplicate the same card and
    // reserve a strip of the focus surface.
    set({ cardFocusId, inspectorNodeId: null, inspectorFieldId: null }),
  closeCardFocus: () =>
    set((state) => ({
      cardFocusId: null,
      ...(state.editingSurface === "focus"
        ? { editingNodeId: null, editingSurface: "canvas" as EditingSurface }
        : {}),
    })),
  setLibraryOpen: (libraryOpen, libraryReason = "reader") => set({ libraryOpen, libraryReason }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  setSelectedNodeIds: (selectedNodeIds) => set({ selectedNodeIds }),
  setSelectedEdgeIds: (selectedEdgeIds) => set({ selectedEdgeIds }),
  setLibraryDrag: (libraryDrag) => set({ libraryDrag }),
  startLinkEndMove: (linkEndMove) => set({ linkEndMove }),
  cancelLinkEndMove: () => set({ linkEndMove: null }),
  selectSection: (selectedSectionId) =>
    set({
      selectedSectionId,
      // Selecting a section opens its panel. Deselecting does not close the
      // drawer by itself: a click on a portal card deselects the section on its
      // way to opening the portal's own panel, and closing here would undo it a
      // frame later. Closing is a pane click or Escape, which call
      // `closeContainerInspector`.
      ...(selectedSectionId
        ? { containerInspector: { kind: "section", id: selectedSectionId } }
        : {}),
      ...(selectedSectionId
        ? {
            selectedNodeIds: [],
            selectedEdgeIds: [],
            selectedConnector: null,
            inspectorNodeId: null,
            inspectorFieldId: null,
            editingNodeId: null,
          }
        : {}),
    }),
  setEditingSection: (editingSectionId) => set({ editingSectionId }),
  setSelectedConnector: (selectedConnector) => set({ selectedConnector }),
  startEditing: (editingNodeId, editingField = "body", editingSurface = "canvas") =>
    set((state) => (state.canEditContent ? { editingNodeId, editingField, editingSurface } : {})),
  stopEditing: () => set({ editingNodeId: null, editingSurface: "canvas" }),
  setEditingField: (editingField) => set({ editingField }),
  setEditingSurface: (editingSurface) => set({ editingSurface }),
  focusCard: (cardId, boardId) => set({ focusTarget: nextFocusTarget("card", cardId, boardId) }),
  focusSection: (sectionId, boardId) =>
    set({ focusTarget: nextFocusTarget("section", sectionId, boardId) }),
  clearFocusTarget: () => set({ focusTarget: null }),
  selectAllOnBoard: (ids) =>
    set({
      selectedNodeIds: ids,
      selectedSectionId: null,
      editingSectionId: null,
      selectedEdgeIds: [],
      selectedConnector: null,
    }),
  openInspector: (inspectorNodeId, fieldId = null) =>
    set((state) => ({
      inspectorNodeId,
      inspectorFieldId: fieldId,
      containerInspector: null,
      // The inspector is the reading surface: opening it ends a focus session,
      // and the panel starts its own edit before accepting keys.
      cardFocusId: null,
      ...(state.editingSurface === "panel" && state.editingNodeId !== inspectorNodeId
        ? { editingNodeId: null, editingSurface: "canvas" as EditingSurface }
        : state.editingSurface === "focus"
          ? { editingNodeId: null, editingSurface: "canvas" as EditingSurface }
          : {}),
      selectedNodeIds: [inspectorNodeId],
      selectedSectionId: null,
      editingSectionId: null,
    })),
  openContainerInspector: (containerInspector) =>
    set({
      containerInspector,
      // A container panel and a card panel are the same drawer: one at a time.
      inspectorNodeId: null,
      inspectorFieldId: null,
      cardFocusId: null,
    }),
  closeContainerInspector: () => set({ containerInspector: null }),

  openTour: (tutorialId) =>
    set((state) =>
      state.tour?.tutorialId === tutorialId
        ? { tour: { ...state.tour, panelOpen: true } }
        : { tour: { tutorialId, stepIndex: 0, presenting: false, panelOpen: true } },
    ),
  presentTour: (tutorialId, stepIndex = 0) =>
    set((state) => ({
      // The tour writes the axis: a presentation is scoped to a tour, so starting
      // one is the only way into `present` (ADR-0064 §11). The widget reads it and
      // can leave it; it can never set it.
      purpose: "present",
      tour: {
        tutorialId,
        stepIndex:
          state.tour?.tutorialId === tutorialId ? state.tour.stepIndex : Math.max(0, stepIndex),
        presenting: true,
        panelOpen: state.tour?.tutorialId === tutorialId ? state.tour.panelOpen : true,
      },
    })),
  setTourStep: (stepIndex) =>
    set((state) =>
      state.tour ? { tour: { ...state.tour, stepIndex: Math.max(0, stepIndex) } } : state,
    ),
  setTourPanelOpen: (panelOpen) =>
    set((state) => (state.tour ? { tour: { ...state.tour, panelOpen } } : state)),
  // Closing the tour drops the purpose that required it: `present` without a
  // tour is the one state `setPurpose` refuses to enter, so leaving it behind
  // would be a state the user cannot reach intentionally and cannot leave by
  // choosing it again.
  closeTour: () =>
    set((state) => ({
      tour: null,
      purpose: state.purpose === "present" ? "explore" : state.purpose,
    })),
  requestPortalOpen: (cardId, boardId) =>
    set({ portalOpenRequest: { cardId, boardId, at: performance.now() } }),
  clearPortalOpenRequest: () => set({ portalOpenRequest: null }),
  closeInspector: () =>
    set((state) => ({
      inspectorNodeId: null,
      inspectorFieldId: null,
      containerInspector: null,
      // Closing the inspector leaves focus mode with it, so Escape cannot strand
      // the canvas behind a surface the reader has already dismissed.
      cardFocusId: null,
      ...(state.editingSurface === "panel" || state.editingSurface === "focus"
        ? { editingNodeId: null, editingSurface: "canvas" as EditingSurface }
        : {}),
    })),
  toggleCardMeta: (id) =>
    set((state) => ({
      expandedCardMeta: { ...state.expandedCardMeta, [id]: !state.expandedCardMeta[id] },
    })),
  openTypeSettings: () => set({ typeSettingsOpen: true }),
  setPaletteOpen: (paletteOpen) =>
    set((state) => (state.paletteOpen === paletteOpen ? state : { paletteOpen })),
  setMode: (mode) => set((state) => (state.mode === mode ? state : { mode })),
  closeTypeSettings: () => set({ typeSettingsOpen: false }),
  toggleLibraryType: (id) =>
    set((state) => ({
      libraryTypeFilter: state.libraryTypeFilter.includes(id)
        ? state.libraryTypeFilter.filter((entry) => entry !== id)
        : [...state.libraryTypeFilter, id],
    })),
  toggleLibraryTag: (id) =>
    set((state) => ({
      libraryTagFilter: state.libraryTagFilter.includes(id)
        ? state.libraryTagFilter.filter((entry) => entry !== id)
        : [...state.libraryTagFilter, id],
    })),
  clearLibraryFilters: () =>
    set({ libraryTypeFilter: [], libraryTagFilter: [], librarySectionFilter: [] }),
  toggleLibrarySection: (id) =>
    set((state) => ({
      librarySectionFilter: state.librarySectionFilter.includes(id)
        ? state.librarySectionFilter.filter((entry) => entry !== id)
        : [...state.librarySectionFilter, id],
    })),
  setLibraryScope: (libraryScope) => set({ libraryScope }),
  setLibraryFull: (libraryFull) => set({ libraryFull }),
  setPlacementOptions: (options) =>
    set((state) => ({ placementOptions: { ...state.placementOptions, ...options } })),
  setPurpose: (purpose) =>
    set((state) => {
      if (state.purpose === purpose) return state;
      // Never a purpose a reader chooses. A control that offered "present" would
      // be offering to present nothing, then asking which tour — a worse way to
      // pick one than opening the tour itself (ADR-0064 §11).
      if (purpose === "present") return state;
      // Leaving these purposes ends what they started, which is the same rule as
      // Escape ending an arm (ADR-0063 §9).
      if (state.purpose === "run") usePlacementRunStore.getState().finish();
      // A recording ends with the purpose that armed it (ADR-0064 §10): the
      // tutorial card keeps the steps it has, but no further click is a step.
      if (state.purpose === "record") useRecordRunStore.getState().stop();
      return {
        purpose,
        // Leaving a presentation stops the takeover but keeps the tour, so the
        // reader lands back on its steps. Escape closes it entirely; the widget is
        // the gentler exit.
        ...(state.tour?.presenting ? { tour: { ...state.tour, presenting: false } } : {}),
      };
    }),
  toggleLibraryGroupBySection: () =>
    set((state) => ({ libraryGroupBySection: !state.libraryGroupBySection })),
  setLibraryQuery: (libraryQuery) => set({ libraryQuery }),
  applyView: (activeViewId, query) =>
    set({
      activeViewId,
      libraryQuery: query.text ?? "",
      libraryTypeFilter: [...query.typeIds],
      libraryTagFilter: [...query.tagIds],
      librarySectionFilter: [...query.sectionIds],
      libraryScope: query.scope,
      libraryGroupBySection: query.groupBySection,
      libraryTab: "cards",
      libraryOpen: true,
      libraryReason: "reader",
    }),
  exitView: () =>
    set({
      activeViewId: null,
      libraryQuery: "",
      libraryTypeFilter: [],
      libraryTagFilter: [],
      librarySectionFilter: [],
      libraryScope: "all",
      libraryGroupBySection: false,
    }),
  toggleOutline: () => set((state) => ({ outlineOpen: !state.outlineOpen })),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
