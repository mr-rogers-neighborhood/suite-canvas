import type { WorkspaceDocument } from "@suite/graph";
import { useEffect, useState } from "react";
import { HistoryPanel } from "../history/HistoryPanel";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * Where the history panel lives in the shell: a toggle in the board's top-right
 * corner, and the panel under it.
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
  const [open, setOpen] = useState(false);
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

  return (
    <div
      className="pointer-events-none absolute top-3 right-3 z-20 flex flex-col items-end gap-2"
      data-testid="history-rail"
    >
      <button
        type="button"
        aria-pressed={open}
        data-testid="history-toggle"
        className="pointer-events-auto rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] shadow-sm hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => setOpen((current) => !current)}
      >
        History
      </button>
      {open ? (
        <div className="pointer-events-auto h-[min(70vh,560px)]">
          <HistoryPanel workspace={workspace} revision={revision} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
