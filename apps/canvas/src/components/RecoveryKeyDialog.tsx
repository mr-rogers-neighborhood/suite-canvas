import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  generateOwnerKey,
  reloadWithOwnerKey,
  rotateOwnerKey,
  writeOwnerKey,
} from "../session/ownerKey";
import { clearSavedRecoveryKey, downloadOwnerKit } from "../session/ownerKit";

export type RecoveryKeyMode = "manage" | "backup-prompt";

export interface RecoveryKeyDialogProps {
  workspaceId: string;
  ownerKey: string;
  /** Used for the downloaded file name, like the backup exports. */
  title?: string;
  /**
   * `manage` is the File-menu dialog. `backup-prompt` is the one contextual
   * offer after a backup export: save a separate key, or decline.
   */
  mode?: RecoveryKeyMode;
  onClose: () => void;
  /** Tests replace the network call. */
  rotate?: typeof rotateOwnerKey;
}

type Stage = "idle" | "confirm" | "rotating" | "rotated";

const MANAGE_COPY =
  "This file restores owner access if this browser is lost. Keep it separate from document backups.";
const PROMPT_COPY =
  "Backup saved. Save a separate recovery key too? It restores owner access if this browser is lost. Keep it separate from the backup.";
const ROTATE_WARNING =
  "Existing editor links and old recovery files will stop working. Shared viewer/editor links keep working.";

/**
 * One small dialog for the recovery key: save it, or replace it. It is only
 * reachable from the File menu (and once after a backup export), so normal
 * editing never carries recovery chrome.
 */
export function RecoveryKeyDialog({
  workspaceId,
  ownerKey,
  title = "workspace",
  mode = "manage",
  onClose,
  rotate = rotateOwnerKey,
}: RecoveryKeyDialogProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [saved, setSaved] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    // Capture: the canvas behind this dialog also listens for Escape.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = () => {
    setError(null);
    try {
      downloadOwnerKit(workspaceId, ownerKey, title);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recovery key could not be saved.");
    }
  };

  const saveNew = () => {
    if (!newKey) return;
    setError(null);
    try {
      downloadOwnerKit(workspaceId, newKey, title);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The new recovery key could not be saved.");
    }
  };

  const replace = async () => {
    setStage("rotating");
    setError(null);
    const next = generateOwnerKey();
    try {
      await rotate(workspaceId, ownerKey, next);
    } catch (cause) {
      // The old key still owns the workspace, so the page keeps working.
      setError(cause instanceof Error ? cause.message : "The owner key was not replaced.");
      setStage("idle");
      return;
    }
    writeOwnerKey(workspaceId, next);
    // The old file no longer matches; the next backup export should prompt again.
    clearSavedRecoveryKey(workspaceId);
    setNewKey(next);
    setSaved(false);
    setStage("rotated");
    try {
      // The download is attempted in the same async chain as the click; if the
      // browser drops it, the dialog keeps a button to try again.
      downloadOwnerKit(workspaceId, next, title);
      setSaved(true);
    } catch {
      setError("The key was replaced, but the recovery file could not be saved. Save it now.");
    }
  };

  const reload = () => {
    if (!newKey) return;
    reloadWithOwnerKey(newKey);
  };

  const closing = mode === "backup-prompt";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close recovery key dialog"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={closing ? "Save a recovery key" : "Recovery key"}
        data-testid={closing ? "recovery-prompt" : "recovery-dialog"}
        className="relative w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {closing ? "Save a recovery key?" : "Recovery key"}
          </h2>
          <button
            type="button"
            aria-label="Close recovery key dialog"
            className="rounded-md px-1.5 py-0.5 text-[13px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
            onClick={onClose}
          >
            {"\u00d7"}
          </button>
        </div>

        <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-muted)]">
          {closing ? PROMPT_COPY : MANAGE_COPY}
        </p>

        {stage === "rotated" ? (
          <p
            className="mt-2 text-[11px] leading-relaxed text-[var(--ink)]"
            data-testid="recovery-saved"
          >
            {saved ? "New recovery key saved." : "Save the new recovery key before reloading."}
          </p>
        ) : saved ? (
          <p className="mt-2 text-[11px] text-[var(--ink)]" data-testid="recovery-saved">
            Saved
          </p>
        ) : null}

        {stage === "confirm" ? (
          <div className="mt-3 rounded-lg border border-[var(--hairline)] p-2">
            <p
              className="text-[11px] leading-relaxed text-[var(--ink)]"
              data-testid="recovery-warning"
            >
              {ROTATE_WARNING}
            </p>
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button
                type="button"
                data-testid="recovery-cancel"
                className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                onClick={() => setStage("idle")}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="recovery-confirm"
                className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] text-[var(--surface)] transition-opacity hover:opacity-90"
                onClick={() => void replace()}
              >
                Replace key
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            data-testid="recovery-error"
            className="mt-2 text-[11px] leading-relaxed text-red-600 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex items-center justify-end gap-1.5">
          {stage === "rotated" ? (
            <>
              <button
                type="button"
                data-testid="recovery-rotate-download"
                className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                onClick={saveNew}
              >
                Download new recovery key
              </button>
              <button
                type="button"
                data-testid="recovery-reload"
                className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[11px] text-[var(--surface)] transition-opacity hover:opacity-90"
                onClick={reload}
              >
                Reload
              </button>
            </>
          ) : (
            <>
              {closing ? (
                <button
                  type="button"
                  data-testid="recovery-prompt-dismiss"
                  className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                  onClick={onClose}
                >
                  Not now
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="recovery-replace"
                  disabled={stage === "rotating"}
                  className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                  onClick={() => setStage("confirm")}
                >
                  Replace recovery key…
                </button>
              )}
              <button
                type="button"
                data-testid={closing ? "recovery-prompt-save" : "recovery-save"}
                disabled={stage === "rotating"}
                className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[11px] text-[var(--surface)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={save}
              >
                {stage === "rotating"
                  ? "Replacing\u2026"
                  : saved
                    ? "Save again"
                    : "Save recovery key"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
