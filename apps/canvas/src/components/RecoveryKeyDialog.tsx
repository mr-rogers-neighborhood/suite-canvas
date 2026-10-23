import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  deriveOwnerKey,
  generateOwnerKey,
  passphraseProblem,
  reloadWithOwnerKey,
  rotateOwnerKey,
  writeOwnerKey,
} from "../session/ownerKey";
import {
  clearSavedRecoveryKey,
  downloadOwnerKit,
  forgetBrowserWorkspace,
  readSavedRecoveryKey,
  type SavedRecoveryKey,
} from "../session/ownerKit";
import { encodeKey, recoveryWordsDocument } from "../session/recoveryWords";
import { revokeAllShares } from "../session/shares";
import { downloadText, fileStem, workspaceUrl } from "../session/workspaceTransfer";
import { useCanvasStore } from "../store/useCanvasStore";

export type RecoveryKeyMode = "manage" | "backup-prompt";

export interface RecoveryKeyDialogProps {
  workspaceId: string;
  ownerKey: string;
  /** Included in the owner link so it opens the board that is in view. */
  boardId?: string | null;
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
  /** Tests replace the link revocation call. */
  revokeShares?: typeof revokeAllShares;
  /** Tests replace the navigation after a forget. */
  leave?: () => void;
}

type Stage = "idle" | "confirm" | "rotating" | "rotated" | "forget" | "forgetting";
type PassphraseStage = "idle" | "confirm" | "rotating";
type RotatedWith = "key" | "passphrase";

const MANAGE_COPY =
  "This file restores owner access if this browser is lost. Keep it separate from document backups.";
const PROMPT_COPY =
  "Backup saved. Save a separate recovery key too? It restores owner access if this browser is lost. Keep it separate from the backup.";
const ROTATE_WARNING =
  "Existing editor links and old recovery files will stop working. You can also revoke every share link.";
const OWNER_LINK_WARNING =
  "This is owner access. Anyone with it can manage links and rotate the key.";
const FORGET_WARNING =
  "The owner key and cached copy will be removed from this browser. The workspace stays on the server and can be reopened with your recovery key or owner link.";
const WORDS_COPY =
  "Recovery words survive a lost browser and a lost file: written down in order, they rebuild this key on any device.";
const PASSPHRASE_COPY =
  "A passphrase survives a lost browser, a lost file and a new device: the same words derive the same key here and anywhere else.";
const PASSPHRASE_WARNING =
  "Existing editor links and old .suitekey recovery files will stop working, because this workspace will accept only the key derived from the passphrase.";
const PASSPHRASE_HINT =
  "Use at least four words and 16 characters. Suite never stores the passphrase.";

function savedLabel(saved: SavedRecoveryKey): string {
  if (saved.savedAt === null) return "Saved on this device";
  const date = new Date(saved.savedAt);
  return `Saved on this device · ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

/**
 * One small dialog for the recovery key: save it, or replace it. It is only
 * reachable from the File menu (and once after a backup export), so normal
 * editing never carries recovery chrome.
 */
export function RecoveryKeyDialog({
  workspaceId,
  ownerKey,
  boardId = null,
  title = "workspace",
  mode = "manage",
  onClose,
  rotate = rotateOwnerKey,
  revokeShares = revokeAllShares,
  leave = () => window.location.assign("/"),
}: RecoveryKeyDialogProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [saved, setSaved] = useState<SavedRecoveryKey | null>(() =>
    readSavedRecoveryKey(workspaceId),
  );
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeLinks, setRevokeLinks] = useState(true);
  const [rotatedWith, setRotatedWith] = useState<RotatedWith>("key");
  const [words, setWords] = useState<string | null>(null);
  const [wordsError, setWordsError] = useState<string | null>(null);
  const [wordsCopied, setWordsCopied] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passStage, setPassStage] = useState<PassphraseStage>("idle");

  const activeKey = newKey ?? ownerKey;
  const passphraseIssue = passphrase.trim().length === 0 ? null : passphraseProblem(passphrase);

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
      setSaved(readSavedRecoveryKey(workspaceId) ?? { savedAt: Date.now() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recovery key could not be saved.");
    }
  };

  const saveNew = () => {
    if (!newKey) return;
    setError(null);
    try {
      downloadOwnerKit(workspaceId, newKey, title);
      setSaved(readSavedRecoveryKey(workspaceId) ?? { savedAt: Date.now() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The new recovery key could not be saved.");
    }
  };

  const revokeLinksAfterRotate = async (next: string): Promise<string | null> => {
    if (!revokeLinks || !revokeShares) return null;
    try {
      await revokeShares(workspaceId, next);
      return null;
    } catch (cause) {
      return cause instanceof Error
        ? `The key was replaced, but links were not revoked: ${cause.message}`
        : "The key was replaced, but links were not revoked.";
    }
  };

  const revealWords = async () => {
    setWordsError(null);
    try {
      setWords(await encodeKey(activeKey));
    } catch (cause) {
      setWordsError(
        cause instanceof Error ? cause.message : "Recovery words could not be prepared.",
      );
    }
  };

  const copyWords = async () => {
    if (!words) return;
    setWordsError(null);
    try {
      await navigator.clipboard.writeText(words);
      setWordsCopied(true);
    } catch {
      setWordsError("The words could not be copied. Your browser blocked the clipboard.");
    }
  };

  const downloadWords = () => {
    if (!words) return;
    setWordsError(null);
    try {
      downloadText(
        `${fileStem(title)}-recovery-words.txt`,
        recoveryWordsDocument(workspaceId, words),
        "text/plain",
      );
    } catch {
      setWordsError("The words could not be saved. Copy them instead.");
    }
  };

  const setWithPassphrase = async () => {
    const problem = passphraseProblem(passphrase);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setPassStage("rotating");
    setError(null);
    let next: string;
    try {
      next = await deriveOwnerKey(passphrase, workspaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The passphrase key could not be derived.");
      setPassStage("idle");
      return;
    }
    try {
      await rotate(workspaceId, ownerKey, next);
    } catch (cause) {
      // The old key still owns the workspace, so the page keeps working.
      setError(cause instanceof Error ? cause.message : "The owner key was not replaced.");
      setPassStage("confirm");
      return;
    }
    const linksError = await revokeLinksAfterRotate(next);
    writeOwnerKey(workspaceId, next);
    clearSavedRecoveryKey(workspaceId);
    setNewKey(next);
    setWords(null);
    setWordsCopied(false);
    setRotatedWith("passphrase");
    setSaved(null);
    setPassStage("idle");
    setPassphrase("");
    setStage("rotated");
    if (linksError) setError(linksError);
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
    const linksError = await revokeLinksAfterRotate(next);
    writeOwnerKey(workspaceId, next);
    // The old file no longer matches; the next backup export should prompt again.
    clearSavedRecoveryKey(workspaceId);
    setNewKey(next);
    setWords(null);
    setRotatedWith("key");
    setSaved(null);
    setStage("rotated");
    if (linksError) setError(linksError);
    try {
      // The download is attempted in the same async chain as the click; if the
      // browser drops it, the dialog keeps a button to try again.
      downloadOwnerKit(workspaceId, next, title);
      setSaved(readSavedRecoveryKey(workspaceId) ?? { savedAt: Date.now() });
    } catch {
      setError("The key was replaced, but the recovery file could not be saved. Save it now.");
    }
  };

  const copyOwnerLink = async () => {
    setError(null);
    const url = workspaceUrl(workspaceId, boardId, newKey ?? ownerKey);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("The owner link could not be copied. Your browser blocked the clipboard.");
    }
  };

  const forget = async () => {
    setStage("forgetting");
    setError(null);
    // Stop the open editor first: its pagehide flush would otherwise write the
    // cached document back after it was deleted.
    useCanvasStore.getState().forgetLocal();
    try {
      await forgetBrowserWorkspace(workspaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This browser could not be cleared.");
      setStage("forget");
      return;
    }
    onClose();
    // The open document still holds the key in memory, so leaving is part of
    // forgetting: the next open starts from a browser that has no key.
    leave();
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
            {rotatedWith === "passphrase"
              ? "Passphrase set. This workspace now accepts only the key derived from it."
              : saved
                ? "New recovery key saved."
                : "Save the new recovery key before reloading."}
          </p>
        ) : saved ? (
          <p className="mt-2 text-[11px] text-[var(--ink)]" data-testid="recovery-saved">
            {savedLabel(saved)}
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
            <label className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--ink)]">
              <input
                type="checkbox"
                data-testid="recovery-revoke-links"
                checked={revokeLinks}
                onChange={(event) => setRevokeLinks(event.target.checked)}
                className="mt-0.5"
              />
              <span>Also revoke all share links (recommended if the key may have leaked)</span>
            </label>
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

        {stage === "forget" || stage === "forgetting" ? (
          <div
            className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-2"
            data-testid="recovery-forget-confirm"
          >
            <p className="text-[11px] font-medium text-[var(--ink)]">Forget this browser?</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink)]">{FORGET_WARNING}</p>
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button
                type="button"
                data-testid="recovery-forget-cancel"
                disabled={stage === "forgetting"}
                className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] disabled:opacity-40 dark:hover:bg-white/10"
                onClick={() => setStage("idle")}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="recovery-forget-confirm-button"
                disabled={stage === "forgetting"}
                className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                onClick={() => void forget()}
              >
                {stage === "forgetting" ? "Forgetting\u2026" : "Forget this browser"}
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
              {rotatedWith === "passphrase" ? (
                <p
                  className="mr-auto max-w-[240px] text-left text-[10px] leading-relaxed text-[var(--ink-muted)]"
                  data-testid="recovery-passphrase-stale"
                >
                  Old editor links and old .suitekey files no longer open this workspace.
                </p>
              ) : (
                <button
                  type="button"
                  data-testid="recovery-rotate-download"
                  className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                  onClick={saveNew}
                >
                  Download new recovery key
                </button>
              )}
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
                  disabled={stage === "rotating" || stage === "forgetting"}
                  className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                  onClick={() => setStage("confirm")}
                >
                  Replace recovery key…
                </button>
              )}
              <button
                type="button"
                data-testid={closing ? "recovery-prompt-save" : "recovery-save"}
                disabled={stage === "rotating" || stage === "forgetting"}
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

        {closing ? null : (
          <div className="mt-3 flex flex-col gap-2 border-t border-[var(--hairline)] pt-2">
            <details>
              <summary
                data-testid="recovery-words-open"
                className="cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                Save recovery words
              </summary>
              <p
                className="mt-1 text-[10px] leading-relaxed text-[var(--ink-muted)]"
                data-testid="recovery-words-copy"
              >
                {WORDS_COPY}
              </p>
              {words ? (
                <>
                  <ol
                    data-testid="recovery-words"
                    className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-0.5 font-mono text-[10px] text-[var(--ink)]"
                  >
                    {words.split(" ").map((word, index) => (
                      <li key={word} className="list-none">
                        <span className="mr-1 text-[var(--ink-muted)]">{index + 1}</span>
                        {word}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-1.5 flex items-center justify-start gap-1.5">
                    <button
                      type="button"
                      data-testid="recovery-words-copy-button"
                      className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => void copyWords()}
                    >
                      {wordsCopied ? "Copied" : "Copy words"}
                    </button>
                    <button
                      type="button"
                      data-testid="recovery-words-download"
                      className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={downloadWords}
                    >
                      Download .txt
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  data-testid="recovery-words-reveal"
                  className="mt-1.5 rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => void revealWords()}
                >
                  Show recovery words
                </button>
              )}
              {wordsError ? (
                <p
                  role="alert"
                  data-testid="recovery-words-error"
                  className="mt-1 text-[10px] leading-relaxed text-red-600 dark:text-red-300"
                >
                  {wordsError}
                </p>
              ) : null}
            </details>

            <details>
              <summary
                data-testid="recovery-passphrase-open"
                className="cursor-pointer text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                Set a passphrase
              </summary>
              <p
                className="mt-1 text-[10px] leading-relaxed text-[var(--ink-muted)]"
                data-testid="recovery-passphrase-copy"
              >
                {PASSPHRASE_COPY}
              </p>
              <input
                type="password"
                aria-label="Passphrase"
                autoComplete="new-password"
                spellCheck={false}
                data-testid="recovery-passphrase-input"
                className="mt-1.5 w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[11px] text-[var(--ink)] outline-none"
                value={passphrase}
                onChange={(event) => {
                  setPassphrase(event.currentTarget.value);
                  setPassStage("idle");
                }}
              />
              <p
                data-testid="recovery-passphrase-problem"
                className={`mt-1 text-[10px] leading-relaxed ${
                  passphraseIssue ? "text-amber-700 dark:text-amber-300" : "text-[var(--ink-muted)]"
                }`}
              >
                {passphraseIssue ?? PASSPHRASE_HINT}
              </p>

              {passStage === "confirm" || passStage === "rotating" ? (
                <div className="mt-1.5 rounded-lg border border-[var(--hairline)] p-2">
                  <p
                    className="text-[11px] leading-relaxed text-[var(--ink)]"
                    data-testid="recovery-passphrase-warning"
                  >
                    {PASSPHRASE_WARNING}
                  </p>
                  <label className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--ink)]">
                    <input
                      type="checkbox"
                      data-testid="recovery-passphrase-revoke-links"
                      checked={revokeLinks}
                      onChange={(event) => setRevokeLinks(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Also revoke all share links (recommended if the old key may have leaked)
                    </span>
                  </label>
                  <div className="mt-2 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      data-testid="recovery-passphrase-cancel"
                      disabled={passStage === "rotating"}
                      className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] disabled:opacity-40 dark:hover:bg-white/10"
                      onClick={() => setPassStage("idle")}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      data-testid="recovery-passphrase-confirm"
                      disabled={passStage === "rotating"}
                      className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-40"
                      onClick={() => void setWithPassphrase()}
                    >
                      {passStage === "rotating" ? "Replacing\u2026" : "Use passphrase"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="recovery-passphrase-continue"
                  disabled={passphraseIssue !== null || stage === "rotated"}
                  className="mt-1.5 rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                  onClick={() => setPassStage("confirm")}
                >
                  Set a passphrase…
                </button>
              )}
            </details>
          </div>
        )}

        {closing ? null : (
          <div className="mt-3 border-t border-[var(--hairline)] pt-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                data-testid="recovery-copy-owner-link"
                className="rounded-md px-1 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
                onClick={() => void copyOwnerLink()}
              >
                Copy owner link
              </button>
              <button
                type="button"
                data-testid="recovery-forget"
                disabled={stage === "forgetting"}
                className="rounded-md px-1 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] disabled:opacity-40 dark:hover:bg-white/10"
                onClick={() => setStage("forget")}
              >
                Forget this browser…
              </button>
            </div>
            <p
              className="mt-1 text-[10px] leading-relaxed text-[var(--ink-muted)]"
              data-testid="recovery-owner-link-warning"
            >
              {copied ? "Owner link copied. " : null}
              {OWNER_LINK_WARNING}
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
