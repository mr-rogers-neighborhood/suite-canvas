import type { WorkspaceDocument } from "@suite/graph";
import { useEffect, useState } from "react";
import { HistoryPanel } from "../history/HistoryPanel";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * Where the version-history panel lives in the shell: a drawer on the right,
 * opened from the navigation row beside the board tabs.
 *
 * The panel reads the document's saved points once and then only when its
 * `revision` changes, so the host counts the snapshot. `useWorkspaceSnapshot()`
 * hands out a new object exactly when a section of the document changed, which
 * is the signal a list of points needs to re-read the oplog.
 */
export interface HistoryPanelHostProps {
  workspace: WorkspaceDocument;
}

export function HistoryPanelHost({ workspace }: HistoryPanelHostProps) {
  const open = useUiStore((state) => state.historyOpen);
  const close = useUiStore((state) => state.closeHistory);
  const snapshot = useWorkspaceSnapshot();
  const [revision, setRevision] = useState(0);

  // One bump per change notification, and none while the panel is closed: a
  // closed panel re-reads when it mounts, so counting then would only re-render
  // the shell for a list nobody can see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot is a re-read trigger, not an input.
  useEffect(() => {
    if (!open) return;
    setRevision((count) => count + 1);
  }, [snapshot, open]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto absolute top-3 right-3 z-20 h-[min(70vh,560px)]"
      data-testid="history-rail"
    >
      <HistoryPanel workspace={workspace} revision={revision} onClose={close} />
    </div>
  );
}
