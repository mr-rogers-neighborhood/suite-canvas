import type { HistoryPoint, HistoryRestorePreview, WorkspaceDocument } from "@suite/graph";
import { useCallback, useEffect, useState } from "react";
import { pointDetail, previewLines, relativeTime } from "./historyFormat";
import { undoWithStack } from "./undoWithStack";

/**
 * The history panel: the saved points a workspace already has, and restoring one.
 *
 * A point is a Loro change, so the list costs a read of the oplog rather than a
 * second store. Restoring is `restoreToPoint`, which writes an ordinary change:
 * it syncs, and `undo` puts it back, which is why the panel offers Undo right
 * after a restore instead of asking for a confirmation first and then nothing.
 *
 * What a restore would do is shown before it happens, under the button that does
 * it, because a revert reaches every change after the point and every peer.
 */
export interface HistoryPanelProps {
  workspace: WorkspaceDocument;
  /** Clock for the relative times; injected so a test or a story is deterministic. */
  now?: number;
  /** Bumped by the host when the document changed, so the list re-reads. */
  revision?: number;
  onClose?: (() => void) | undefined;
}

export function HistoryPanel({ workspace, now, revision = 0, onClose }: HistoryPanelProps) {
  const clock = now ?? Date.now();
  const [points, setPoints] = useState<HistoryPoint[]>(() => workspace.listHistoryPoints());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<HistoryRestorePreview | null>(null);
  const [restored, setRestored] = useState(false);

  const reread = useCallback(() => {
    setPoints(workspace.listHistoryPoints());
    setSelectedId(null);
    setPreview(null);
  }, [workspace]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is a re-read trigger, not an input.
  useEffect(reread, [reread, revision]);

  const select = (point: HistoryPoint) => {
    setRestored(false);
    if (point.current) {
      setSelectedId(point.id);
      setPreview(null);
      return;
    }
    setSelectedId(point.id);
    setPreview(workspace.previewRestore(point.id));
  };

  const restore = () => {
    if (!selectedId) return;
    workspace.restoreToPoint(selectedId);
    reread();
    setRestored(true);
  };

  const undo = () => {
    undoWithStack(workspace);
    reread();
    setRestored(false);
  };

  return (
    <section
      aria-labelledby="history-heading"
      data-testid="history-panel"
      className="flex h-full w-[320px] flex-col overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)]"
    >
      <header className="flex items-center justify-between border-b border-[var(--hairline)] px-3 py-2">
        <h2 id="history-heading" className="text-[12px] font-semibold tracking-wide uppercase">
          History
        </h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            data-testid="history-close"
            className="rounded px-1 text-[13px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            {"\u00d7"}
          </button>
        ) : null}
      </header>

      {restored ? (
        <p
          role="status"
          data-testid="history-restored"
          className="border-b border-[var(--hairline)] bg-black/[0.03] px-3 py-2 text-[11px] dark:bg-white/5"
        >
          Restored. Undo puts every change back.
          <button
            type="button"
            onClick={undo}
            data-testid="history-undo"
            className="ml-2 underline underline-offset-2"
          >
            Undo
          </button>
        </p>
      ) : null}

      {points.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12px] text-[var(--ink-muted)]">
          This workspace has no saved points yet.
        </p>
      ) : (
        <ul
          data-testid="history-points"
          aria-label="Saved points, newest first"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {points.map((point) => {
            const selected = point.id === selectedId;
            return (
              <li key={point.id}>
                <button
                  type="button"
                  onClick={() => select(point)}
                  aria-current={point.current ? "true" : undefined}
                  aria-pressed={selected}
                  data-testid={`history-point-${point.id}`}
                  className={`block w-full px-3 py-1.5 text-left text-[12px] ${
                    selected
                      ? "bg-black/5 dark:bg-white/10"
                      : "hover:bg-black/[0.03] dark:hover:bg-white/5"
                  } ${point.current ? "text-[var(--ink-muted)]" : ""}`}
                >
                  <span className="block truncate">{point.label}</span>
                  <span className="block truncate text-[10px] text-[var(--ink-muted)]">
                    {relativeTime(point.at, clock)} {"\u00b7"} {pointDetail(point)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {preview && selectedId ? (
        <section
          aria-labelledby="history-preview-heading"
          data-testid="history-preview"
          className="border-t border-[var(--hairline)] px-3 py-2 text-[11px]"
        >
          <h3 id="history-preview-heading" className="text-[11px] font-semibold">
            Restore to {relativeTime(preview.point.at, clock)}?
          </h3>
          <p data-testid="history-preview-summary" className="mt-1 leading-4">
            {preview.summary}
          </p>
          <ul data-testid="history-preview-lines" className="mt-1 space-y-0.5">
            {previewLines(preview).map((line) => (
              <li key={`${line.kind}:${line.text}`} data-kind={line.kind} className="truncate">
                {line.kind === "removed" ? "\u2212 " : line.kind === "restored" ? "+ " : "\u2192 "}
                {line.text}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={restore}
              disabled={preview.empty}
              data-testid="history-restore"
              className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)] disabled:opacity-40"
            >
              Restore this point
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setPreview(null);
              }}
              data-testid="history-cancel"
              className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[11px]"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
