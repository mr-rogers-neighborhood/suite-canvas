import type { Board, Card, GraphEdge, Placement } from "@suite/graph";
import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";

export interface WorkspaceSnapshot {
  boards: Board[];
  cards: Card[];
  placements: Placement[];
  edges: GraphEdge[];
}

function read(
  workspace: ReturnType<typeof useCanvasStore.getState>["workspace"],
): WorkspaceSnapshot {
  return {
    boards: workspace.listBoards(),
    cards: workspace.listCards(),
    placements: workspace.listPlacements(),
    edges: workspace.listEdges(),
  };
}

/**
 * React binding for the workspace. Subscribes to CRDT changes and returns a
 * fresh snapshot so components re-render on any mutation, local or remote.
 */
export function useWorkspaceSnapshot(): WorkspaceSnapshot {
  const workspace = useCanvasStore((state) => state.workspace);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => read(workspace));

  useEffect(() => {
    const refresh = () => setSnapshot(read(workspace));
    refresh();
    return workspace.observe(refresh);
  }, [workspace]);

  return snapshot;
}
