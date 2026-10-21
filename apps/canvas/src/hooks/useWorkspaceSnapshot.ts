import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { applyWorkspaceChange } from "./snapshotChanges";
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
 * React binding for the workspace. One full read covers mount and workspace
 * swaps; afterwards each observe record is folded in on its own, so a peer's
 * edit no longer re-reads (or re-materialises) the whole workspace.
 */
export function useWorkspaceSnapshot(): WorkspaceSnapshot {
  const workspace = useCanvasStore((state) => state.workspace);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => read(workspace));

  useEffect(() => {
    setSnapshot((previous) => mergeSnapshots(previous, read(workspace)));
    return workspace.observe((change) => {
      setSnapshot((previous) => applyWorkspaceChange(previous ?? read(workspace), change));
    });
  }, [workspace]);

  return snapshot;
}
