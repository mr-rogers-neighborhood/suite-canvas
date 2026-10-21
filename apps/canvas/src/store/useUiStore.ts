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
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
