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

interface UiState {
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  editingNodeId: string | null;
  contextMenu: ContextMenuState | null;
  selectedConnector: SelectedConnector | null;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  setSelectedConnector: (connector: SelectedConnector | null) => void;
  setEditingNodeId: (id: string | null) => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedNodeIds: [],
  selectedEdgeIds: [],
  editingNodeId: null,
  contextMenu: null,
  selectedConnector: null,
  setSelectedNodeIds: (selectedNodeIds) => set({ selectedNodeIds }),
  setSelectedEdgeIds: (selectedEdgeIds) => set({ selectedEdgeIds }),
  setSelectedConnector: (selectedConnector) => set({ selectedConnector }),
  setEditingNodeId: (editingNodeId) => set({ editingNodeId }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
