import { create } from "zustand";

export interface ContextMenuState {
  x: number;
  y: number;
  kind: "canvas" | "node" | "connector";
  nodeId?: string;
  connectorId?: string;
  flowPosition?: { x: number; y: number };
}

export interface SelectedConnector {
  nodeId: string;
  connectorId: string;
}

interface UiState {
  selectedNodeIds: string[];
  editingNodeId: string | null;
  contextMenu: ContextMenuState | null;
  selectedConnector: SelectedConnector | null;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedConnector: (connector: SelectedConnector | null) => void;
  setEditingNodeId: (id: string | null) => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedNodeIds: [],
  editingNodeId: null,
  contextMenu: null,
  selectedConnector: null,
  setSelectedNodeIds: (selectedNodeIds) => set({ selectedNodeIds }),
  setSelectedConnector: (selectedConnector) => set({ selectedConnector }),
  setEditingNodeId: (editingNodeId) => set({ editingNodeId }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
