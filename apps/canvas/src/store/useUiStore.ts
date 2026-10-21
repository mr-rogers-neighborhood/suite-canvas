import { create } from "zustand";

export interface ContextMenuState {
  x: number;
  y: number;
  kind: "canvas" | "node" | "connector" | "edge";
  nodeId?: string;
  connectorId?: string;
  edgeId?: string;
  flowPosition?: { x: number; y: number };
}

export interface SelectedConnector {
  nodeId: string;
  connectorId: string;
}

export type LibraryTab = "inbox" | "cards" | "trash";

interface UiState {
  /** Board currently on screen; null until the shell resolves one. */
  activeBoardId: string | null;
  libraryOpen: boolean;
  libraryTab: LibraryTab;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  editingNodeId: string | null;
  /** Which editor on the card has focus; titles come first for new cards. */
  editingField: "title" | "body";
  /** Card whose inspector panel is open, if any. */
  inspectorNodeId: string | null;
  /** Type registry editor, opened from the dock or the inspector. */
  typeSettingsOpen: boolean;
  /** Facet filters for the library drawer; OR within a group, AND across. */
  libraryTypeFilter: string[];
  libraryTagFilter: string[];
  contextMenu: ContextMenuState | null;
  selectedConnector: SelectedConnector | null;
  setActiveBoardId: (id: string | null) => void;
  setLibraryOpen: (open: boolean) => void;
  setLibraryTab: (tab: LibraryTab) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  setSelectedConnector: (connector: SelectedConnector | null) => void;
  startEditing: (id: string, field?: "title" | "body") => void;
  stopEditing: () => void;
  setEditingField: (field: "title" | "body") => void;
  openInspector: (id: string) => void;
  closeInspector: () => void;
  openTypeSettings: () => void;
  closeTypeSettings: () => void;
  toggleLibraryType: (id: string) => void;
  toggleLibraryTag: (id: string) => void;
  clearLibraryFilters: () => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeBoardId: null,
  libraryOpen: false,
  libraryTab: "inbox",
  selectedNodeIds: [],
  selectedEdgeIds: [],
  editingNodeId: null,
  editingField: "body",
  inspectorNodeId: null,
  typeSettingsOpen: false,
  libraryTypeFilter: [],
  libraryTagFilter: [],
  contextMenu: null,
  selectedConnector: null,
  setActiveBoardId: (activeBoardId) => set({ activeBoardId }),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  setSelectedNodeIds: (selectedNodeIds) => set({ selectedNodeIds }),
  setSelectedEdgeIds: (selectedEdgeIds) => set({ selectedEdgeIds }),
  setSelectedConnector: (selectedConnector) => set({ selectedConnector }),
  startEditing: (editingNodeId, editingField = "body") => set({ editingNodeId, editingField }),
  stopEditing: () => set({ editingNodeId: null }),
  setEditingField: (editingField) => set({ editingField }),
  openInspector: (inspectorNodeId) => set({ inspectorNodeId, selectedNodeIds: [inspectorNodeId] }),
  closeInspector: () => set({ inspectorNodeId: null }),
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
  clearLibraryFilters: () => set({ libraryTypeFilter: [], libraryTagFilter: [] }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
