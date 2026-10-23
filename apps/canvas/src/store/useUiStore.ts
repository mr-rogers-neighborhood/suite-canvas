import type { ViewQuery } from "@suite/graph";
import { create } from "zustand";
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

export type LibraryTab = "inbox" | "cards" | "pins" | "trash";

/**
 * Which editor of one card holds the keystrokes; only one may be editable at a
 * time. `focus` is the full-canvas card surface, which owns the body editor the
 * same way the inspector's `panel` does.
 */
export type EditingSurface = "canvas" | "panel" | "focus";

/** React Flow's viewport: world-to-screen translate plus zoom. */
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

/** One nested level inside the infinite scene; the camera restores on pop. */
export interface SceneFocusEntry {
  /** Board ids from the root board to this instance, inclusive. */
  path: string[];
  boardId: string;
  /** The portal card that opened this level; absent at the root. */
  portalCardId?: string;
  /** Camera checkpoint to restore when this level is left. */
  camera: ViewportState;
  label?: string;
  nonce: number;
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
  /** Viewport last seen on each board, so a return lands where it left. */
  boardViewports: Record<string, ViewportState>;
  /** Boards visited from the current one, newest last. */
  boardHistory: BoardVisit[];
  /** Nested scene levels entered without switching the root board, newest last. */
  sceneFocusPath: SceneFocusEntry[];
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
  libraryTab: LibraryTab;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  /** Section selected on the active board, if any. */
  selectedSectionId: string | null;
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
  /**
   * A camera request from the shell: the canvas pans to this board point and
   * clears it. Navigation only — never a document write.
   */
  pendingPinFocus: { x: number; y: number } | null;
  focusPinAt: (point: { x: number; y: number } | null) => void;
  /** Bumped by the pins list to ask the canvas to drop a pin; the canvas owns the point. */
  dropPinRequest: number;
  requestDropPin: () => void;
  /**
   * Bumped by the Dock's Graph view control. The ceiling is a camera, not a
   * mode, so this is a request for a flight: the ICE surface owns the motion
   * and owns the band that follows it (ADR-0037).
   */
  graphViewRequest: number;
  requestGraphView: () => void;
  /** Whether the board outline rail is expanded. */
  outlineOpen: boolean;
  contextMenu: ContextMenuState | null;
  selectedConnector: SelectedConnector | null;
  /** Scope a canvas gesture asked the app-bar dialog to open on; consumed once. */
  shareRequest: ShareScope | null;
  requestShare: (scope: ShareScope) => void;
  clearShareRequest: () => void;
  setActiveBoardId: (id: string | null) => void;
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
  /** Push one nested scene level; the current camera becomes its checkpoint. */
  pushSceneFocus: (entry: Omit<SceneFocusEntry, "nonce">) => void;
  /** Pop the deepest scene level and return it, or null at the root. */
  popSceneFocus: () => SceneFocusEntry | null;
  clearSceneFocus: () => void;
  recordBoardViewport: (boardId: string, viewport: ViewportState) => void;
  clearViewportRequest: () => void;
  requestPortalEntry: (request: PortalEntryRequest) => void;
  clearPortalEntry: () => void;
  openCardFocus: (cardId: string) => void;
  closeCardFocus: () => void;
  setLibraryOpen: (open: boolean) => void;
  setLibraryTab: (tab: LibraryTab) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  selectSection: (id: string | null) => void;
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
  boardViewports: {},
  boardHistory: [],
  sceneFocusPath: [],
  viewportRequest: null,
  portalEntry: null,
  cardFocusId: null,
  readOnly: getSession().readOnly,
  setReadOnly: (readOnly) => set({ readOnly }),
  setCapabilities: (capabilities) => set(capabilities),
  libraryOpen: false,
  libraryTab: "inbox",
  pendingPinFocus: null,
  dropPinRequest: 0,
  graphViewRequest: 0,
  selectedNodeIds: [],
  selectedEdgeIds: [],
  selectedSectionId: null,
  editingSectionId: null,
  editingNodeId: null,
  editingField: "body",
  editingSurface: "canvas",
  focusTarget: null,
  inspectorNodeId: null,
  inspectorFieldId: null,
  expandedCardMeta: {},
  typeSettingsOpen: false,
  libraryTypeFilter: [],
  libraryTagFilter: [],
  librarySectionFilter: [],
  libraryScope: "all",
  libraryGroupBySection: false,
  activeViewId: null,
  libraryQuery: "",
  outlineOpen: true,
  contextMenu: null,
  selectedConnector: null,
  shareRequest: null,
  requestShare: (shareRequest) => set({ shareRequest }),
  clearShareRequest: () => set({ shareRequest: null }),
  setActiveBoardId: (activeBoardId) => set({ activeBoardId }),
  activateBoard: (boardId, options = {}) =>
    set((state) => {
      if (state.activeBoardId === boardId) return state;
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
        // A tab click is a new root; a nested focus path belongs to the old one.
        sceneFocusPath: [],
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
  pushSceneFocus: (entry) =>
    set((state) => ({
      sceneFocusPath: [...state.sceneFocusPath, { ...entry, nonce: nextNavigationNonce() }],
    })),
  popSceneFocus: () => {
    const state = get();
    const entry = state.sceneFocusPath.at(-1);
    if (!entry) return null;
    set({ sceneFocusPath: state.sceneFocusPath.slice(0, -1) });
    return entry;
  },
  clearSceneFocus: () => set({ sceneFocusPath: [] }),
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
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  focusPinAt: (pendingPinFocus) => set({ pendingPinFocus }),
  requestDropPin: () => set((state) => ({ dropPinRequest: state.dropPinRequest + 1 })),
  requestGraphView: () => set((state) => ({ graphViewRequest: state.graphViewRequest + 1 })),
  setSelectedNodeIds: (selectedNodeIds) => set({ selectedNodeIds }),
  setSelectedEdgeIds: (selectedEdgeIds) => set({ selectedEdgeIds }),
  selectSection: (selectedSectionId) =>
    set({
      selectedSectionId,
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
  closeInspector: () =>
    set((state) => ({
      inspectorNodeId: null,
      inspectorFieldId: null,
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
