import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { generateOwnerKey, readOwnerKey, writeOwnerKey } from "../session/ownerKey";
import { hasSavedRecoveryKey, readOwnerKitFile } from "../session/ownerKit";
import { isShareSession } from "../session/session";
import {
  downloadWorkspaceById,
  forgetWorkspace,
  importWorkspaceFile,
  navigateTo,
  newWorkspaceId,
  openNewWorkspace,
  openWorkspace,
  type RecentWorkspace,
  readRecentWorkspaces,
  rememberWorkspace,
  workspaceUrl,
} from "../session/workspaceTransfer";

/** The prompt only ever names one workspace at a time. */
interface RecoveryPrompt {
  workspaceId: string;
  ownerKey: string;
  title: string;
}

/** A new workspace whose passphrase choice has not been answered yet. */
interface CreationChoice {
  workspaceId: string;
  ownerKey: string;
}

function openedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The starting screen: a workspace picker rather than a document. Recent
 * workspaces are local metadata; opening one navigates to that workspace's
 * ordinary canvas route.
 */
const RecoveryKeyDialog = lazy(async () => {
  const module = await import("../components/RecoveryKeyDialog");
  return { default: module.RecoveryKeyDialog };
});

const DeleteWorkspaceDialog = lazy(async () => {
  const module = await import("../components/DeleteWorkspaceDialog");
  return { default: module.DeleteWorkspaceDialog };
});

export function WorkspaceLauncher() {
  const [recents, setRecents] = useState<RecentWorkspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<RecoveryPrompt | null>(null);
  const [choice, setChoice] = useState<CreationChoice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecentWorkspace | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const recoveryInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setRecents(readRecentWorkspaces());
  }, []);

  /**
   * A passphrase only helps where the relay can own the workspace from any
   * device, and it is the owner's decision: a share session or a viewer gets the
   * plain new workspace, with no choice to make.
   */
  const offerPassphrase = import.meta.env.VITE_SUITE_MODE !== "standalone" && !isShareSession();

  /**
   * The id and the key are made here but written only when the choice is
   * answered, so closing the dialog leaves no half-made workspace behind.
   */
  const startNew = () => {
    if (!offerPassphrase) {
      openNewWorkspace();
      return;
    }
    setChoice({ workspaceId: newWorkspaceId(), ownerKey: generateOwnerKey() });
  };

  /** The one place a new workspace is written, whichever key was chosen. */
  const openCreated = (workspaceId: string, ownerKey: string) => {
    writeOwnerKey(workspaceId, ownerKey);
    rememberWorkspace({ id: workspaceId, title: "Untitled workspace" });
    const url = new URL(workspaceUrl(workspaceId, null, ownerKey));
    url.searchParams.set("fresh", "1");
    navigateTo(url.toString());
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await importWorkspaceFile(file);
      openWorkspace(imported.id, imported.boardId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import that workspace.");
      setBusy(false);
    }
  };

  const exportRecent = async (entry: RecentWorkspace) => {
    setBusy(true);
    setError(null);
    try {
      await downloadWorkspaceById(entry.id, entry.title);
      // Same offer as the workspace's own backup export: only when this browser
      // still holds an owner key it has never saved.
      const ownerKey = readOwnerKey(entry.id);
      if (ownerKey && !hasSavedRecoveryKey(entry.id)) {
        setPrompt({ workspaceId: entry.id, ownerKey, title: entry.title });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export that workspace.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * A recovery file names its own workspace, so it opens that workspace instead
   * of importing a document. Nothing is written unless the file validates, and
   * nothing is added to recents: the file is the way in.
   */
  const openRecoveryKey = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const kit = await readOwnerKitFile(file);
      // The key file is the authority for this browser from now on; the
      // workspace itself is only created when the editor loads it.
      writeOwnerKey(kit.workspaceId, kit.ownerKey);
      navigateTo(workspaceUrl(kit.workspaceId, null, kit.ownerKey));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that recovery key file.");
      setBusy(false);
    }
  };

  return (
    <main
      data-testid="workspace-launcher"
      className="flex min-h-screen items-center justify-center bg-[var(--canvas-bg)] px-4 py-10 text-[var(--ink)]"
    >
      <div className="w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.55)]">
        <header className="border-b border-[var(--hairline)] px-8 pt-8 pb-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            Local-first canvas
          </p>
          <div className="mt-2 flex items-end justify-between gap-6">
            <div>
              <h1 className="text-[34px] font-semibold tracking-tight">Suite</h1>
              <p className="mt-1 max-w-[420px] text-[13px] leading-5 text-[var(--ink-muted)]">
                Pick up a workspace, open a project file, or start a blank one. Everything stays in
                this browser until you export it.
              </p>
            </div>
            <span aria-hidden="true" className="hidden sm:block">
              <img src="/suite-logo-black.svg" alt="" className="h-14 w-14 dark:hidden" />
              <img src="/suite-logo-white.svg" alt="" className="hidden h-14 w-14 dark:block" />
            </span>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="launcher-new"
              className="rounded-lg bg-[var(--ink)] px-4 py-2 text-[13px] font-medium text-[var(--surface)] transition-opacity hover:opacity-90"
              onClick={startNew}
              disabled={busy}
            >
              New workspace
            </button>
            <button
              type="button"
              data-testid="launcher-import"
              className="rounded-lg border border-[var(--hairline)] px-4 py-2 text-[13px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              Open workspace file…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".suite,.json,application/json"
              className="hidden"
              data-testid="launcher-file"
              onChange={(event) => {
                void importFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              data-testid="launcher-open-recovery"
              className="rounded-lg border border-[var(--hairline)] px-4 py-2 text-[13px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => recoveryInput.current?.click()}
              disabled={busy}
              title="Open a .suitekey recovery file for a workspace you already own."
            >
              Open recovery key…
            </button>
            <input
              ref={recoveryInput}
              type="file"
              accept=".suitekey,.json,application/json"
              className="hidden"
              data-testid="launcher-recovery-file"
              onChange={(event) => {
                void openRecoveryKey(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
          {error ? (
            <p
              role="alert"
              data-testid="launcher-error"
              className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}
        </header>

        <section className="px-8 py-6" aria-labelledby="recent-title">
          <div className="flex items-center justify-between">
            <h2 id="recent-title" className="text-[12px] font-semibold uppercase tracking-wide">
              Recent workspaces
            </h2>
            <span className="text-[11px] text-[var(--ink-muted)]">{recents.length} saved</span>
          </div>

          {recents.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-[var(--hairline)] px-4 py-8 text-center text-[13px] text-[var(--ink-muted)]">
              Nothing here yet. Start a new workspace or open a <code>.suite</code> file.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--hairline)]">
              {recents.map((entry) => (
                <li
                  key={entry.id}
                  data-testid={`launcher-recent-${entry.id}`}
                  className="group flex items-center gap-3 py-2.5"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openWorkspace(entry.id, entry.boardId)}
                  >
                    <span className="block truncate text-[13px] font-medium">{entry.title}</span>
                    <span className="block truncate text-[11px] text-[var(--ink-muted)]">
                      {entry.boardId ? `${entry.boardId} · ` : ""}
                      {openedAt(entry.lastOpenedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid={`launcher-export-${entry.id}`}
                    className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/10"
                    onClick={() => void exportRecent(entry)}
                    disabled={busy}
                  >
                    Export
                  </button>
                  {import.meta.env.VITE_SUITE_MODE === "standalone" ? (
                    <button
                      type="button"
                      data-testid={`launcher-delete-${entry.id}`}
                      aria-label="Delete this workspace…"
                      title="Delete this workspace…"
                      className="rounded-md px-2 py-1 text-[11px] text-red-600 opacity-0 transition-opacity hover:bg-red-50 group-hover:opacity-100 focus:opacity-100 dark:text-red-300 dark:hover:bg-red-500/15"
                      onClick={() => setDeleteTarget(entry)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Remove from this list (does not delete the workspace)"
                    title="Remove from this list (does not delete the workspace)"
                    className="rounded-md px-2 py-1 text-[13px] text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/10"
                    onClick={() => {
                      forgetWorkspace(entry.id);
                      setRecents(readRecentWorkspaces());
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="border-t border-[var(--hairline)] px-8 py-3 text-[11px] text-[var(--ink-muted)]">
          A workspace is a Loro document. Export a <code>.suite</code> backup to keep your own copy;
          the file is the only import path.
        </footer>
      </div>
      {choice ? (
        <Suspense fallback={null}>
          <RecoveryKeyDialog
            mode="creation-prompt"
            workspaceId={choice.workspaceId}
            ownerKey={choice.ownerKey}
            title="Untitled workspace"
            onClose={() => setChoice(null)}
            onSkip={() => openCreated(choice.workspaceId, choice.ownerKey)}
            onSetPassphrase={(derivedKey) => openCreated(choice.workspaceId, derivedKey)}
          />
        </Suspense>
      ) : null}
      {prompt ? (
        <Suspense fallback={null}>
          <RecoveryKeyDialog
            mode="backup-prompt"
            workspaceId={prompt.workspaceId}
            ownerKey={prompt.ownerKey}
            title={prompt.title}
            onClose={() => setPrompt(null)}
          />
        </Suspense>
      ) : null}
      {deleteTarget ? (
        <Suspense fallback={null}>
          <DeleteWorkspaceDialog
            mode="standalone"
            workspaceId={deleteTarget.id}
            title={deleteTarget.title}
            onClose={() => setDeleteTarget(null)}
            onDeleted={() => {
              setDeleteTarget(null);
              setRecents(readRecentWorkspaces());
              navigateTo("/");
            }}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
