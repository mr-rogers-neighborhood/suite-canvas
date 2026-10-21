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
  const ready = useCanvasStore((state) => state.ready);
  const synced = useCanvasStore((state) => state.synced);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => read(workspace));

  // biome-ignore lint/correctness/useExhaustiveDependencies: ready/synced are re-read triggers, not effect inputs.
  useEffect(() => {
    // Hydration and the first server sync can land between the initial read and
    // the observer registration. Re-read when either gate flips so a snapshot
    // taken before the import cannot stay empty.
    setSnapshot((previous) => mergeSnapshots(previous, read(workspace)));
    return workspace.observe((change) => {
      setSnapshot((previous) => applyWorkspaceChange(previous ?? read(workspace), change));
    });
  }, [workspace, ready, synced]);

  return snapshot;
}
