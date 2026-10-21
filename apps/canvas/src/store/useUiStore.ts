import { create } from "zustand";

export interface ContextMenuState {
  x: number;
  y: number;
  kind: "canvas" | "node";
  nodeId?: string;
  flowPosition?: { x: number; y: number };
}

interface UiState {
  selectedNodeIds: string[];
  editingNodeId: string | null;
  contextMenu: ContextMenuState | null;
  setSelectedNodeIds: (ids: string[]) => void;
  setEditingNodeId: (id: string | null) => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedNodeIds: [],
  editingNodeId: null,
  contextMenu: null,
  setSelectedNodeIds: (selectedNodeIds) => set({ selectedNodeIds }),
  setEditingNodeId: (editingNodeId) => set({ editingNodeId }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
