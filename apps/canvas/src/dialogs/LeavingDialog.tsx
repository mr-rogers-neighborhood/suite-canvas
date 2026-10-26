import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "../shell/escapeLayers";

/**
 * The in-app leave interstitial (ADR-0025
 * amendment).
 *
 * Shown only while `storageLadder()` reports `banner`: the work is saved here, and this browser has
 * not promised to keep it. One sentence says what the risk is; the two actions that make the work
 * safe are the ones that already exist — the account dialog and the backup export — and "Leave
 * anyway" is a real choice, so leaving proceeds.
 */
export interface LeavingDialogProps {
  workspaceId: string;
  /** The workspace's label, so the exported backup is named like every other export. */
  title: string;
  /** Opens the account's sign-in dialog. Absent in a build that has no accounts. */
  onSignIn?: (() => void) | undefined;
  /** Proceeds to the launcher. */
  onLeave: () => void;
  /** The reader was told and has answered (stayed, or chose to leave): do not ask again. */
  onDismiss: () => void;
}

export function LeavingDialog({
  workspaceId,
  title,
  onSignIn,
  onLeave,
  onDismiss,
}: LeavingDialogProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [exported, setExported] = useState<"idle" | "done" | "failed">("idle");

  useEscapeLayer(onDismiss);
  useEffect(() => {
    panel.current?.focus();
  }, []);

  // The same backup File → Export backup writes: a leave prompt is not the place
  // to invent a second export format.
  const exportCopy = useCallback(async () => {
    try {
      const [{ downloadWorkspaceBackup }, { useCanvasStore }] = await Promise.all([
        import("../session/workspaceTransfer"),
        import("../store/useCanvasStore"),
      ]);
      await downloadWorkspaceBackup(workspaceId, useCanvasStore.getState().workspace, title);
      setExported("done");
    } catch {
      setExported("failed");
    }
  }, [workspaceId, title]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label="Stay in this workspace"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onDismiss}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Before you leave"
        tabIndex={-1}
        data-testid="leaving-dialog"
        className="relative w-[min(380px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl outline-none"
      >
        <h2 className="text-sm font-semibold">Before you leave</h2>
        <p
          data-testid="leaving-sentence"
          className="mt-1.5 text-xs leading-relaxed text-[var(--ink-muted)]"
        >
          This workspace is saved only in this browser, and the browser may clear it when the device
          needs the space.
        </p>
        {exported === "failed" ? (
          <p
            role="alert"
            data-testid="leaving-export-error"
            className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] leading-5 text-red-800 dark:text-red-200"
          >
            The copy could not be written. Try again, or leave anyway — the work stays in this
            browser until it is cleared.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {onSignIn === undefined ? null : (
            <button
              type="button"
              data-testid="leaving-sign-in"
              onClick={() => {
                // The sign-in dialog stacks above this one; the warning has been
                // delivered, so this one steps aside.
                onDismiss();
                onSignIn();
              }}
              className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            >
              Sign in
            </button>
          )}
          <button
            type="button"
            data-testid="leaving-export"
            onClick={() => void exportCopy()}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            {exported === "done" ? "Copy saved" : "Export a copy"}
          </button>
          <button
            type="button"
            data-testid="leaving-anyway"
            onClick={() => {
              onDismiss();
              onLeave();
            }}
            className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-xs text-[var(--surface)] transition-colors hover:opacity-90"
          >
            Leave anyway
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
