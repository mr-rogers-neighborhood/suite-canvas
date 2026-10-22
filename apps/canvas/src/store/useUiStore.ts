import { create } from "zustand";

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

export type LibraryTab = "inbox" | "cards" | "trash";

/** Which editor of one card holds the keystrokes; only one may be editable at a time. */
export type EditingSurface = "canvas" | "panel";

/**
 * Which panel owns a card's `editingSurface: "panel"` session. The inspector
 * and an expanded library row are both panels, and the surface alone cannot
 * tell them apart.
 */
export type PanelOwner = "inspector" | "library";

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

interface UiState {
  /** Board currently on screen; null until the shell resolves one. */
  activeBoardId: string | null;
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
  /** Panel that owns the current panel editing session, if any. */
  panelOwner: PanelOwner | null;
  /** Card or section a surface asked to reveal; consumed once by the canvas. */
  focusTarget: FocusTarget | null;
  /** Card whose inspector panel is open, if any. */
  inspectorNodeId: string | null;
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
  /** Whether the board outline rail is expanded. */
  outlineOpen: boolean;
  contextMenu: ContextMenuState | null;
  selectedConnector: SelectedConnector | null;
  setActiveBoardId: (id: string | null) => void;
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
  setPanelOwner: (owner: PanelOwner | null) => void;
  focusCard: (cardId: string, boardId: string) => void;
  focusSection: (sectionId: string, boardId: string) => void;
  clearFocusTarget: () => void;
  /** Replaces the selection with every card on the board; the inspector is untouched. */
  selectAllOnBoard: (ids: string[]) => void;
  openInspector: (id: string) => void;
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

export const useUiStore = create<UiState>((set) => ({
  activeBoardId: null,
  libraryOpen: false,
  libraryTab: "inbox",
  selectedNodeIds: [],
  selectedEdgeIds: [],
  selectedSectionId: null,
  editingSectionId: null,
  editingNodeId: null,
  editingField: "body",
  editingSurface: "canvas",
  panelOwner: null,
  focusTarget: null,
  inspectorNodeId: null,
  expandedCardMeta: {},
  typeSettingsOpen: false,
  libraryTypeFilter: [],
  libraryTagFilter: [],
  librarySectionFilter: [],
  libraryScope: "all",
  libraryGroupBySection: false,
  outlineOpen: true,
  contextMenu: null,
  selectedConnector: null,
  setActiveBoardId: (activeBoardId) => set({ activeBoardId }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
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
            editingNodeId: null,
          }
        : {}),
    }),
  setEditingSection: (editingSectionId) => set({ editingSectionId }),
  setSelectedConnector: (selectedConnector) => set({ selectedConnector }),
  startEditing: (editingNodeId, editingField = "body", editingSurface = "canvas") =>
    set({ editingNodeId, editingField, editingSurface }),
  stopEditing: () => set({ editingNodeId: null, editingSurface: "canvas" }),
  setEditingField: (editingField) => set({ editingField }),
  setEditingSurface: (editingSurface) => set({ editingSurface }),
  setPanelOwner: (panelOwner) =>
    set((state) => ({
      panelOwner,
      // Changing panels ends the previous panel's session; the new owner has
      // to start its own edit before an editor accepts keystrokes.
      ...(state.panelOwner !== panelOwner && state.editingSurface === "panel"
        ? { editingNodeId: null, editingSurface: "canvas" as EditingSurface }
        : {}),
    })),
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
  openInspector: (inspectorNodeId) =>
    set((state) => ({
      inspectorNodeId,
      panelOwner: "inspector",
      // A library row that was editable a moment ago must not keep a session.
      ...(state.panelOwner === "library" && state.editingSurface === "panel"
        ? { editingNodeId: null, editingSurface: "canvas" as EditingSurface }
        : {}),
      selectedNodeIds: [inspectorNodeId],
      selectedSectionId: null,
      editingSectionId: null,
    })),
  closeInspector: () =>
    set((state) => ({
      inspectorNodeId: null,
      panelOwner: null,
      ...(state.editingSurface === "panel"
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
  toggleOutline: () => set((state) => ({ outlineOpen: !state.outlineOpen })),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
