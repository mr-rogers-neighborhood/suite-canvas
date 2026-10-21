import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { mergeSnapshots, type WorkspaceSnapshot } from "./snapshotMerge";

export type { WorkspaceSnapshot } from "./snapshotMerge";

type Workspace = ReturnType<typeof useCanvasStore.getState>["workspace"];

function read(workspace: Workspace): WorkspaceSnapshot {
  return {
    boards: workspace.listBoards(),
    cards: workspace.listCards(),
    placements: workspace.listPlacements(),
    edges: workspace.listEdges(),
  };
}

/**
 * React binding for the workspace. Subscribes to CRDT changes and returns a
 * snapshot whose unchanged collections keep their identity.
 */
export function useWorkspaceSnapshot(): WorkspaceSnapshot {
  const workspace = useCanvasStore((state) => state.workspace);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => read(workspace));

  useEffect(() => {
    const refresh = () => setSnapshot((previous) => mergeSnapshots(previous, read(workspace)));
    refresh();
    return workspace.observe(refresh);
  }, [workspace]);

  return snapshot;
}
