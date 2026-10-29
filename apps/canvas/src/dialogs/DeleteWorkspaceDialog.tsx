import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteWorkspaceEverywhere, type WorkspaceDeleteProfile } from "../session/workspaceDelete";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useFocusTrap } from "./useFocusTrap";

export interface DeleteWorkspaceDialogProps {
  workspaceId: string;
  /** Human title, used in the copy and accepted as the confirmation. */
  title?: string;
  /** Which halves exist: the relay copy and the local copy, or local only. */
  mode: WorkspaceDeleteProfile;
  /** `Authorization` for the relay half. Absent falls back to this page's session. */
  authorization?: () => Promise<Record<string, string>>;
  onClose: () => void;
  /** Called after the delete committed and this browser was purged. */
  onDeleted: () => void;
  /** Tests replace the delete call. */
  remove?: typeof deleteWorkspaceEverywhere;
}

const RELAY_COPY =
  "This deletes the server's copy and this browser's copy: the document and its share links. Share links stop working.";
const RELAY_LIMITS =
  "Other devices that have already opened this workspace keep their offline copy until they next open it. There will be nothing to sync then, and they will be told this workspace no longer exists.";
const LOCAL_COPY =
  "This deletes this browser's copy of the document. There is no server copy, so this browser is the only place this workspace exists.";
const LOCAL_LIMITS =
  "Export a backup first if you might want it again. Other browsers keep whatever they already have.";

/**
 * The one confirmation for deleting a workspace. It always asks for the name or
 * id to be typed: a single click is never enough, and a failure is reported
 * inline without touching the local copy.
 */
export function DeleteWorkspaceDialog({
  workspaceId,
  title = "workspace",
  mode,
  authorization,
  onClose,
  onDeleted,
  remove = deleteWorkspaceEverywhere,
}: DeleteWorkspaceDialogProps) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const name = title.trim() || workspaceId;

  useEscapeLayer(onClose);
  useFocusTrap(panel);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const confirmed = typed.trim() === name || typed.trim() === workspaceId.trim();

  const submit = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await remove({
        workspaceId,
        profile: mode,
        ...(authorization ? { authorization } : {}),
        // The open editor must stop writing first, or its pagehide flush would
        // recreate the document just deleted. It runs only after a relay delete
        // committed, so a failed request leaves the local copy alone.
        beforePurge: () => useCanvasStore.getState().forgetLocal(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The workspace was not deleted. This browser still has its copy.",
      );
      setBusy(false);
      return;
    }
    onDeleted();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={busy ? undefined : onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Delete this workspace?"
        tabIndex={-1}
        data-testid="delete-workspace-dialog"
        className="relative w-[min(440px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">Delete this workspace?</h2>
        <p
          className="mt-2 text-xs leading-relaxed text-[var(--ink)]"
          data-testid="delete-workspace-copy"
        >
          {mode === "relay" ? RELAY_COPY : LOCAL_COPY}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ink-muted)]">
          {mode === "relay" ? RELAY_LIMITS : LOCAL_LIMITS}
        </p>
        <label
          className="mt-3 block text-[11px] text-[var(--ink-muted)]"
          htmlFor="delete-workspace-confirm"
        >
          Type <span className="font-mono text-[var(--ink)]">{name}</span> to confirm.
        </label>
        <input
          id="delete-workspace-confirm"
          ref={input}
          data-testid="delete-workspace-confirm-input"
          className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1.5 text-xs"
          value={typed}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
        />
        {error ? (
          <p
            role="alert"
            data-testid="delete-workspace-error"
            className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-1.5">
          <button
            type="button"
            data-testid="delete-workspace-cancel"
            disabled={busy}
            className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] disabled:opacity-40 dark:hover:bg-white/10"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="delete-workspace-confirm-button"
            disabled={!confirmed || busy}
            className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? "Deleting\u2026" : "Delete workspace"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
