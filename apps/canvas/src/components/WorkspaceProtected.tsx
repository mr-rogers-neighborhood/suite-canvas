/**
 * Stand-in for the shell when the relay says another key owns this workspace.
 * It only needs the theme and the logo: no store, no sync connection, no
 * document. The way back in is the recovery key file saved from the File menu,
 * or an editor link that carries the owner fragment.
 *
 * A 409 has two shapes and the copy names the right one from this device's
 * claim record: the workspace was worked on here before anyone owned it and was
 * claimed in the meantime, or this browser's key was replaced. Both keep the
 * local document — only a device that never had one omits that sentence.
 */

import { useRef, useState } from "react";
import {
  type ClaimRecord,
  claimWorkspace,
  readClaimRecord,
  reloadWithOwnerKey,
  writeOwnerKey,
} from "../session/ownerKey";
import { OWNER_KIT_MISMATCH, readOwnerKit } from "../session/ownerKit";

export interface WorkspaceProtectedProps {
  /** Workspace the page is trying to open; an imported key must belong to it. */
  workspaceId?: string | null;
}

export interface ConflictCopy {
  /** What happened, in the order it happened. */
  detail: string;
  /**
   * True only when this device opened the workspace before, so it really does
   * hold a local copy worth keeping.
   */
  keepsLocalCopy: boolean;
}

const EXITS = "Open a recovery key file, or the editor link that includes the current owner key.";

/**
 * The two 409s read differently even though they are the same outcome. The
 * claim record — not the relay — says which one this is: `pending` means the
 * workspace was edited here before anyone owned it and was claimed by someone
 * else in the meantime, `claimed` means this browser used to own it. Neither
 * discards the local document, and neither may say so on a device that never
 * had one.
 */
export function conflictCopy(record: ClaimRecord | null): ConflictCopy {
  if (record === "pending") {
    return {
      detail: "This device worked on the workspace offline, and another browser claimed it first.",
      keepsLocalCopy: true,
    };
  }
  if (record === "claimed") {
    return {
      detail: "The owner key on this device was replaced by another browser.",
      keepsLocalCopy: true,
    };
  }
  return {
    detail: "Another browser's owner key already owns this workspace.",
    keepsLocalCopy: false,
  };
}

function protectedCopy(record: ClaimRecord | null): string {
  const { detail, keepsLocalCopy } = conflictCopy(record);
  return keepsLocalCopy
    ? `${detail} Your edits on this device are kept. ${EXITS}`
    : `${detail} ${EXITS}`;
}

export function WorkspaceProtected({ workspaceId = null }: WorkspaceProtectedProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const record = readClaimRecord(workspaceId ?? "");

  const open = async (text: string, name?: string) => {
    setError(null);
    if (!workspaceId) {
      setError("This page does not name a workspace, so a key cannot be applied.");
      return;
    }
    let parsed: { workspaceId: string; ownerKey: string };
    try {
      parsed = readOwnerKit(text, workspaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not read ${name ?? "that file"}.`);
      return;
    }

    setBusy(true);
    try {
      // The claim is the real verification: a wrong key is refused here instead
      // of after a reload that would land back on this screen. A key that could
      // not be verified is not installed either, but the local document is
      // never touched, so nothing is lost by waiting for the relay.
      const claim = await claimWorkspace(workspaceId, parsed.ownerKey);
      if (claim === "conflict") {
        setError(OWNER_KIT_MISMATCH);
        return;
      }
      if (claim !== "claimed") {
        setError(
          "The server could not be reached, so this key is not verified yet. Your edits on this device are kept — try again when you are back online.",
        );
        return;
      }
      writeOwnerKey(workspaceId, parsed.ownerKey);
      reloadWithOwnerKey(parsed.ownerKey);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return;
    try {
      await open(await file.text(), file.name);
    } catch {
      setError("That file could not be read.");
    }
  };

  return (
    <div
      className="app-canvas flex h-screen w-screen flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="workspace-protected"
    >
      <img src="/suite-logo-black.svg" alt="Suite" className="h-10 w-10 dark:hidden" />
      <img src="/suite-logo-white.svg" alt="Suite" className="hidden h-10 w-10 dark:block" />
      <div className="max-w-[360px]">
        <h1 className="text-[15px] font-semibold text-[var(--ink)]">
          This workspace is protected.
        </h1>
        <p
          data-testid="workspace-protected-detail"
          data-conflict={record ?? "unknown"}
          className="mt-1 text-[12px] leading-5 text-[var(--ink-muted)]"
        >
          {protectedCopy(record)}
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="recovery-open"
          disabled={busy}
          className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          onClick={() => fileInput.current?.click()}
        >
          Open recovery key file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".suitekey,.json,application/json"
          data-testid="recovery-file"
          className="sr-only"
          onChange={(event) => {
            void onFile(event.currentTarget.files?.[0]);
            // Allow choosing the same file again after an error.
            event.currentTarget.value = "";
          }}
        />

        <details className="w-[280px] text-left">
          <summary className="cursor-pointer text-center text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]">
            Paste recovery key
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            <textarea
              aria-label="Recovery key file contents"
              data-testid="recovery-paste"
              rows={4}
              spellCheck={false}
              placeholder='{"kind":"suite.owner",…}'
              className="w-full resize-none rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 font-mono text-[10px] text-[var(--ink)] outline-none"
              value={paste}
              onChange={(event) => setPaste(event.currentTarget.value)}
            />
            <button
              type="button"
              data-testid="recovery-paste-apply"
              disabled={busy || paste.trim().length === 0}
              className="self-end rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] text-[var(--surface)] disabled:opacity-40"
              onClick={() => void open(paste, "the pasted key")}
            >
              {busy ? "Opening\u2026" : "Use key"}
            </button>
          </div>
        </details>
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="recovery-error"
          className="max-w-[360px] text-[11px] leading-relaxed text-red-600 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <a
        href="/"
        data-testid="workspace-protected-launcher"
        className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
      >
        Open Suite
      </a>
    </div>
  );
}
