import { STARTER_TEMPLATES, type WorkspaceTemplate } from "@suite/graph";
import type { VaultFile } from "@suite/import-obsidian";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAccountStore } from "../auth/useAccountStore";
import { SendFeedbackBubble } from "../feedback/SendFeedbackBubble";
import { ToastLayer } from "../feedback/ToastLayer";
import { toast } from "../feedback/toast";
import { syncLabelOf, syncStateOf } from "../session/accountWorkspaces";
import {
  DEFAULT_WORKSPACE_NAME,
  forgetWorkspaceName,
  readWorkspaceNames,
  refreshWorkspaceNames,
  rememberWorkspaceName,
  renameCachedWorkspace,
  resolveWorkspaceName,
  workspaceNameProblem,
} from "../session/workspaceName";
import { pinnedWorkspaceOrder, readWorkspacePins } from "../session/workspacePins";
import {
  downloadWorkspaceById,
  forgetWorkspace,
  importWorkspaceFile,
  navigateTo,
  newWorkspaceId,
  openWorkspace,
  type RecentWorkspace,
  readRecentWorkspaces,
  rememberWorkspace,
  workspaceUrl,
} from "../session/workspaceTransfer";
import { AlphaNotice } from "./AlphaNotice";
import { ImportMenu } from "./ImportMenu";
import {
  DEFAULT_STARTER_TEMPLATE_ID,
  loadStarterTemplates,
  rememberChosenTemplate,
  starterTemplateById,
} from "./starterTemplates";
import { useAccountWorkspaces } from "./useAccountWorkspaces";
import { importVaultIntoWorkspace, vaultFilesFromPicker, vaultName } from "./vaultImport";
import { readVaultZip } from "./vaultZip";

/** A recents row with the workspace name resolved for display. */
interface RecentEntry extends RecentWorkspace {
  name: string;
}

function openedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The workspace name leads the row; the last board name is only a fallback. */
function labelRecent(
  entry: RecentWorkspace,
  names: Record<string, string>,
  fallback = entry.title,
): RecentEntry {
  return { ...entry, name: resolveWorkspaceName(names[entry.id], fallback) };
}

/**
 * The account surfaces pull in the Better Auth client, so they are loaded on
 * demand for the same reason as the editor's: a standalone build has no server
 * and must not ship a byte of `/api/auth`.
 */
const AccountSurface = lazy(async () => {
  const module = await import("../auth/AccountSurface");
  return { default: module.AccountSurface };
});

/**
 * The screen an invitation email lands on. Loaded on demand for the same reason
 * as the account surface: it reaches `/api/auth`, and a standalone build has no
 * server to reach.
 */
const AcceptInvitation = lazy(async () => {
  const module = await import("../auth/AcceptInvitation");
  return { default: module.AcceptInvitation };
});

/**
 * The starting screen: a workspace picker rather than a document. Recent
 * workspaces are local metadata; opening one navigates to that workspace's
 * ordinary canvas route.
 *
 * Identity belongs here, not only in the title bar: this is the first screen a
 * person sees, and "sign in to keep this anywhere" is one of the two things this
 * screen is for.
 */
const DeleteWorkspaceDialog = lazy(async () => {
  const module = await import("../dialogs/DeleteWorkspaceDialog");
  return { default: module.DeleteWorkspaceDialog };
});

export function WorkspaceLauncher() {
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * What the screen is doing, in a sentence. A boolean left the reader to guess
   * whether an import was running, finished or never started; this is the same
   * state and it says which.
   */
  const [progress, setProgress] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"opened" | "name">("opened");
  const busy = progress !== null;
  const [deleteTarget, setDeleteTarget] = useState<RecentEntry | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  /**
   * The shape a new workspace starts as. Notebook is preselected because a new
   * workspace should open with somewhere to write; Blank is still one choice away.
   */
  const [template, setTemplate] = useState(DEFAULT_STARTER_TEMPLATE_ID);
  /**
   * The starters on offer, built in until the deployment answers. The built-ins
   * render on the first frame so the select is never empty, and a cached or
   * fetched list replaces them a moment later.
   */
  const [templates, setTemplates] = useState<readonly WorkspaceTemplate[]>(STARTER_TEMPLATES);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  /** The row an "Import" press belongs to: a vault merges into the workspace you name. */
  const vaultInput = useRef<HTMLInputElement | null>(null);
  const zipInput = useRef<HTMLInputElement | null>(null);
  const [vaultTarget, setVaultTarget] = useState<RecentEntry | null>(null);
  /** The row whose import menu is open, if any. */
  const [importMenu, setImportMenu] = useState<string | null>(null);
  const renameCancelled = useRef(false);
  // A mail link names one invitation, and this page is where it lands.
  const [invitationId, setInvitationId] = useState<string | null>(null);
  // `null` until the account answers, and stays `null` when there is no session.
  const { account } = useAccountWorkspaces();
  const [bringDismissed, setBringDismissed] = useState(false);

  useEffect(() => {
    void (async () => {
      if (import.meta.env.VITE_SUITE_MODE === "standalone") return;
      const { invitationIdFromUrl } = await import("../auth/AcceptInvitation");
      setInvitationId(invitationIdFromUrl(window.location.href));
    })();
  }, []);

  useEffect(() => {
    // Cache, then server, then the built-ins; `loadStarterTemplates` never throws.
    let live = true;
    void loadStarterTemplates().then((loaded) => {
      if (!live) return;
      setTemplates(loaded);
      // A deployment whose list does not carry the preselected starter can still
      // open a blank workspace, so the select is never left on a value it does not
      // offer.
      setTemplate((current) => (starterTemplateById(loaded, current) === undefined ? "" : current));
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    // Pinned first, then recency: the same order the workspace menu uses, so a pin means
    // one thing in both places. A launcher is where a pinned workspace is most useful —
    // it is the page a new tab lands on.
    const entries = pinnedWorkspaceOrder(readRecentWorkspaces(), readWorkspacePins());
    const names = readWorkspaceNames();
    setRecents(entries.map((entry) => labelRecent(entry, names)));
    // A cached replica carries the newest name — including a rename made on
    // another device — so each launcher visit re-reads it. No live subscription:
    // the workspace is either open in the editor or not shown here at all.
    let live = true;
    void refreshWorkspaceNames(entries.map((entry) => entry.id)).then((refreshed) => {
      if (!live) return;
      setRecents((current) => current.map((entry) => labelRecent(entry, refreshed, entry.name)));
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * A new workspace is written here and nowhere else. There is no credential to
   * create: the document id is the workspace's identity, and the session decides
   * who may open it.
   *
   * A chosen template travels in the URL rather than being written here: the
   * document does not exist until the editor opens it, so the template is
   * applied there, once, on the same boot that seeds a blank workspace.
   */
  /**
   * The list as the reader asked for it: a query narrows by name, and the order
   * is last opened (the list's own meaning) or name (when looking for one).
   */
  const shown = recents
    .filter((entry) => {
      const needle = query.trim().toLowerCase();
      return needle.length === 0 || entry.name.toLowerCase().includes(needle);
    })
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name),
    );

  const startNew = () => {
    const workspaceId = newWorkspaceId();
    const chosen = starterTemplateById(templates, template);
    // `?template=` carries an id, and an id only resolves a starter this bundle was
    // built with. The chosen template therefore travels as itself as well, which is
    // the only way a starter that came from the server can be applied at all.
    if (chosen !== undefined) rememberChosenTemplate(workspaceId, chosen);
    rememberWorkspace({ id: workspaceId, title: DEFAULT_WORKSPACE_NAME });
    const url = new URL(workspaceUrl(workspaceId, null));
    url.searchParams.set("fresh", "1");
    if (chosen !== undefined) url.searchParams.set("template", chosen.id);
    navigateTo(url.toString());
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setProgress(`Opening ${file.name}\u2026`);
    setError(null);
    setNotice(null);
    try {
      const imported = await importWorkspaceFile(file);
      // An image the file could not carry is named by its cards, and the import
      // still opens: the warning is a line on the way in, not a refusal.
      if (imported.warnings.length > 0) setNotice(imported.warnings.join(" "));
      openWorkspace(imported.id, imported.boardId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import that workspace.");
      setProgress(null);
    }
  };

  /**
   * Drops go into a workspace this browser already holds; the row is the choice
   * of workspace, so nothing is created and nothing has to be named twice.
   *
   * `dataTransfer.items` is only readable while the drop event is being
   * handled, so the entries are taken before the first `await`.
   */
  const importVault = async (entry: RecentEntry, transfer: DataTransfer) => {
    const entries = Array.from(transfer.items, (item) => item.webkitGetAsEntry());
    const homeBoardName = vaultName(entries);
    setProgress(`Importing ${homeBoardName ?? entry.name}\u2026`);
    setError(null);
    setNotice(null);
    try {
      const outcome = await importVaultIntoWorkspace({
        workspaceId: entry.id,
        entries,
        ...(homeBoardName === undefined ? {} : { homeBoardName }),
      });
      if (!outcome.ok) {
        toast.failure(outcome.message, {
          urgent: true,
          ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        });
        return;
      }
      // A partial import still lands: the toast names what did not come across,
      // and the workspace's own history has it as one change.
      toast.success(outcome.message, {
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        ...(outcome.boardId === undefined
          ? {}
          : {
              action: {
                label: "Open",
                onAction: () => openWorkspace(entry.id, outcome.boardId ?? null),
              },
            }),
      });
      setRecents(readRecentWorkspaces().map((row) => labelRecent(row, readWorkspaceNames())));
    } finally {
      setProgress(null);
    }
  };

  /**
   * A vault picked rather than dropped: the same import through the other door.
   *
   * A drag is unavailable on a tablet, and a row is the choice of workspace a drop
   * already makes, so the picker is per row. Two shapes arrive this way — a folder from
   * a directory picker, and a zip a Files app can hand over but not unpack — and both
   * end here, because only the reading differs.
   */
  const importVaultFrom = async (
    entry: RecentEntry,
    read: () => Promise<{ files: VaultFile[]; name: string | undefined }>,
    failure: string,
  ) => {
    setProgress(`Importing ${entry.name}\u2026`);
    setError(null);
    setNotice(null);
    try {
      const { files, name } = await read();
      const outcome = await importVaultIntoWorkspace({
        workspaceId: entry.id,
        files,
        ...(name === undefined ? {} : { homeBoardName: name }),
      });
      if (!outcome.ok) {
        toast.failure(outcome.message, {
          urgent: true,
          ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        });
        return;
      }
      toast.success(outcome.message, {
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        ...(outcome.boardId === undefined
          ? {}
          : {
              action: {
                label: "Open",
                onAction: () => openWorkspace(entry.id, outcome.boardId ?? null),
              },
            }),
      });
      setRecents(readRecentWorkspaces().map((row) => labelRecent(row, readWorkspaceNames())));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setProgress(null);
    }
  };

  const importVaultFolder = (entry: RecentEntry, list: FileList | null) => {
    if (!list || list.length === 0) return;
    void importVaultFrom(entry, () => vaultFilesFromPicker(list), "Could not import that folder.");
  };

  const importVaultZip = (entry: RecentEntry, list: FileList | null) => {
    const archive = list?.[0];
    if (!archive) return;
    void importVaultFrom(
      entry,
      async () => readVaultZip(new Uint8Array(await archive.arrayBuffer()), archive.name),
      "Could not read that archive.",
    );
  };

  const exportRecent = async (entry: RecentEntry) => {
    setProgress(`Exporting ${entry.name}\u2026`);
    setError(null);
    setNotice(null);
    try {
      // An export is the only copy a launcher user has, so a size or
      // missing-image warning is shown here exactly as the editor shows it.
      await downloadWorkspaceById(entry.id, entry.name, setNotice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export that workspace.");
    } finally {
      setProgress(null);
    }
  };

  const startRename = (entry: RecentEntry) => {
    renameCancelled.current = false;
    setRenamingId(entry.id);
    setDraft(entry.name);
    setNameError(null);
  };

  /**
   * The name is written to the recents mirror first, so the row is right even
   * when the document is not in this browser. A cached document is the one
   * writable copy; a relay-only recent has nothing local to write to yet.
   */
  const commitRename = async (entry: RecentEntry) => {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    const problem = workspaceNameProblem(draft);
    if (problem) {
      setNameError(problem);
      return;
    }
    const name = draft.trim();
    setRenamingId(null);
    setNameError(null);
    setRecents((current) => current.map((row) => (row.id === entry.id ? { ...row, name } : row)));
    rememberWorkspaceName(entry.id, name);
    try {
      await renameCachedWorkspace(entry.id, name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename that workspace.");
    }
  };

  return (
    <main
      data-testid="workspace-launcher"
      className="workspace-launcher flex min-h-screen items-center justify-center bg-[var(--canvas-bg)] px-4 py-10 text-[var(--ink)]"
      // A vault is dropped on a row, never on the page. Claiming the drag here
      // stops the browser from navigating to the dropped file when someone
      // misses a row, which would lose the launcher instead of doing nothing.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <div className="w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.55)]">
        <header className="border-b border-[var(--hairline)] px-8 pt-8 pb-7">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-[34px] font-semibold tracking-tight">Suite</h1>
              <p className="mt-1 max-w-[420px] text-[13px] leading-5 text-[var(--ink-muted)]">
                <i>A structured, local-first, collaborative canvas.</i>
                <br />
                <br />
                You can open a workspace file, pick from a list of recent workspaces, or create a
                new one.
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
            {/* A folder picker for the same import a drop performs, for a machine with
                no drag: `webkitdirectory` has no JSX spelling, so the ref sets it. */}
            <input
              ref={(element) => {
                vaultInput.current = element;
                if (element) element.webkitdirectory = true;
              }}
              type="file"
              hidden
              multiple
              data-testid="launcher-vault-input"
              onChange={(event) => {
                const target = vaultTarget;
                const files = event.target.files;
                event.target.value = "";
                setVaultTarget(null);
                if (target) importVaultFolder(target, files);
              }}
            />
            {/* A tablet's Files app can hand over one file but cannot unpack a folder,
                so a zipped vault is the shape some devices offer. It is the same import
                past a reader, not a second importer. */}
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip"
              hidden
              data-testid="launcher-vault-zip-input"
              onChange={(event) => {
                const target = vaultTarget;
                const files = event.target.files;
                event.target.value = "";
                setVaultTarget(null);
                if (target) importVaultZip(target, files);
              }}
            />
            {/* Identity lives here as well as in the title bar: this is the first
                screen someone sees, and an account is what keeps a workspace
                across devices. The literal keeps every byte of `/api/auth` out of
                a standalone build. */}
            {import.meta.env.VITE_SUITE_MODE !== "standalone" ? (
              <span className="ml-auto">
                <Suspense fallback={null}>
                  <AccountSurface showSignUp />
                </Suspense>
              </span>
            ) : null}
          </div>
          {/* Notebook is the default rather than Blank: a new workspace should open
              with somewhere to write, and an empty document is still one choice
              away. It sits on its own line because it belongs to "New workspace",
              not beside it, and the description follows the choice rather than
              stretching the select until the name is cut off. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink-muted)]">
            <label className="flex items-center gap-2">
              <span>Start from</span>
              <select
                data-testid="launcher-template"
                aria-label="Workspace template"
                value={template}
                onChange={(event) => setTemplate(event.target.value)}
                disabled={busy}
                className="max-w-[220px] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--ink)]"
              >
                <option value="">Blank</option>
                {templates.map((starter) => (
                  <option key={starter.id} value={starter.id}>
                    {starter.name}
                  </option>
                ))}
              </select>
            </label>
            <span data-testid="launcher-template-detail" className="text-[11px]">
              {templates.find((starter) => starter.id === template)?.description ??
                "An empty board."}
            </span>
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
          {progress ? (
            <p
              role="status"
              aria-live="polite"
              data-testid="launcher-progress"
              className="mt-3 rounded-lg border border-[var(--hairline)] bg-[var(--segmented-bg)] px-3 py-2 text-[12px] text-[var(--ink)]"
            >
              {progress}
            </p>
          ) : null}
          {notice ? (
            <p
              data-testid="launcher-notice"
              className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-200"
            >
              {notice}
            </p>
          ) : null}
        </header>

        {invitationId === null ? null : (
          <div className="px-8 pt-6">
            <Suspense fallback={null}>
              <AcceptInvitation invitationId={invitationId} />
            </Suspense>
          </div>
        )}

        <section className="px-8 py-6" aria-labelledby="recent-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="recent-title" className="text-[12px] font-semibold uppercase tracking-wide">
              Recent workspaces
            </h2>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                <span className="sr-only">Sort the recent workspaces</span>
                <select
                  data-testid="launcher-sort"
                  aria-label="Sort the recent workspaces"
                  value={sort}
                  onChange={(event) => setSort(event.target.value === "name" ? "name" : "opened")}
                  className="rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--ink)]"
                >
                  <option value="opened">Last opened</option>
                  <option value="name">Name</option>
                </select>
              </label>
              <input
                type="search"
                data-testid="launcher-search"
                aria-label="Search the recent workspaces"
                placeholder="Search this list"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-40 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--ink)] outline-none"
              />
              <span className="text-[11px] text-[var(--ink-muted)]">
                {shown.length === recents.length
                  ? `${recents.length} saved`
                  : `${shown.length} of ${recents.length}`}
              </span>
            </div>
          </div>

          {/* A signed-in account that holds nothing, beside workspaces saved here, is
              the one moment bringing them along is worth mentioning. The sentence used to
              say "open one while signed in", which stopped being true when a plan became
              the thing that puts a workspace in an account: the claim answers
              `plan-required` and the workspace stays where it is. So the notice says what
              the obstacle is and carries the door to it. */}
          {account !== null &&
          account.workspaces.length === 0 &&
          recents.length > 0 &&
          !bringDismissed ? (
            <div
              data-testid="launcher-bring-prompt"
              className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2.5"
            >
              <div className="min-w-0 flex-1 text-[12px] leading-5">
                <p className="font-medium">These are saved on this device only.</p>
                <p className="text-[var(--ink-muted)]">
                  A plan is what puts them in your account, on every device.
                </p>
              </div>
              <button
                type="button"
                data-testid="launcher-bring-plans"
                className="shrink-0 rounded-lg bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)]"
                onClick={() => useAccountStore.getState().openPanel("plan")}
              >
                See plans
              </button>
              <button
                type="button"
                data-testid="launcher-bring-dismiss"
                aria-label="Dismiss"
                className="rounded-md px-2 py-0.5 text-[13px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setBringDismissed(true)}
              >
                ×
              </button>
            </div>
          ) : null}

          {recents.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-[var(--hairline)] px-4 py-8 text-center text-[13px] text-[var(--ink-muted)]">
              Nothing here yet. Start a new workspace or open a <code>.suite</code> file.
            </p>
          ) : (
            <>
              <p className="mt-3 text-[11px] text-[var(--ink-muted)]">
                Drop an Obsidian vault folder onto a workspace to import its notes and canvases.
              </p>
              {shown.length === 0 ? (
                <p
                  data-testid="launcher-search-empty"
                  className="mt-3 rounded-lg border border-dashed border-[var(--hairline)] px-3 py-4 text-center text-[12px] text-[var(--ink-muted)]"
                >
                  No workspace here matches “{query.trim()}”.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-[var(--hairline)]">
                  {shown.map((entry) => {
                    const renaming = renamingId === entry.id;
                    const dropping = dropTargetId === entry.id;
                    // The board name repeats the workspace name until someone names
                    // the workspace, so it only earns space when it differs.
                    const board = entry.title?.trim();
                    const detail = [board && board !== entry.name ? board : null, entry.boardId]
                      .filter((part): part is string => Boolean(part))
                      .join(" · ");
                    return (
                      <li
                        key={entry.id}
                        data-testid={`launcher-recent-${entry.id}`}
                        data-drop-target={dropping ? "vault" : undefined}
                        className={`group flex items-center gap-3 py-2.5 ${
                          dropping
                            ? "rounded-lg bg-black/5 ring-1 ring-blue-400 dark:bg-white/10"
                            : ""
                        }`}
                        onDragOver={(event) => {
                          // Claiming the drop is what makes this row a target.
                          event.preventDefault();
                          setDropTargetId(entry.id);
                        }}
                        onDragLeave={() =>
                          setDropTargetId((current) => (current === entry.id ? null : current))
                        }
                        onDrop={(event) => {
                          event.preventDefault();
                          setDropTargetId(null);
                          void importVault(entry, event.dataTransfer);
                        }}
                      >
                        {renaming ? (
                          <div className="min-w-0 flex-1">
                            <input
                              // biome-ignore lint/a11y/noAutofocus: inline rename is an explicit gesture
                              autoFocus
                              data-testid={`launcher-rename-input-${entry.id}`}
                              aria-label={`Rename ${entry.name}`}
                              aria-invalid={nameError ? true : undefined}
                              value={draft}
                              className="w-full rounded bg-transparent px-1 text-[13px] font-medium leading-5 outline-none ring-1 ring-blue-400"
                              onChange={(event) => {
                                setDraft(event.target.value);
                                setNameError(null);
                              }}
                              onBlur={() => void commitRename(entry)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                                if (event.key === "Escape") {
                                  renameCancelled.current = true;
                                  setRenamingId(null);
                                  setNameError(null);
                                }
                              }}
                            />
                            <span
                              data-testid={`launcher-rename-hint-${entry.id}`}
                              role={nameError ? "alert" : undefined}
                              className={`block truncate text-[11px] leading-4 ${
                                nameError
                                  ? "text-red-600 dark:text-red-300"
                                  : "text-[var(--ink-muted)]"
                              }`}
                            >
                              {nameError ?? "Enter to save · Escape to cancel"}
                            </span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => openWorkspace(entry.id, entry.boardId)}
                          >
                            <span
                              data-testid={`launcher-name-${entry.id}`}
                              className="block truncate text-[13px] font-medium"
                            >
                              {entry.name}
                            </span>
                            <span className="flex items-baseline gap-2 text-[11px] text-[var(--ink-muted)]">
                              <span
                                data-testid={`launcher-detail-${entry.id}`}
                                title={detail}
                                className="min-w-0 truncate"
                              >
                                {detail}
                              </span>
                              <span className="shrink-0">{openedAt(entry.lastOpenedAt)}</span>
                              {syncLabelOf(syncStateOf(entry.id, account)) === null ? null : (
                                <span
                                  data-testid={`launcher-sync-${entry.id}`}
                                  data-sync={syncStateOf(entry.id, account)}
                                  className="shrink-0 rounded-full border border-[var(--hairline)] px-1.5 text-[10px] leading-4"
                                >
                                  {syncLabelOf(syncStateOf(entry.id, account))}
                                </span>
                              )}
                            </span>
                          </button>
                        )}
                        {renaming ? null : (
                          <button
                            type="button"
                            data-testid={`launcher-rename-${entry.id}`}
                            aria-label={`Rename ${entry.name}`}
                            title="Rename workspace"
                            className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/10"
                            onClick={() => startRename(entry)}
                            disabled={busy}
                          >
                            Rename
                          </button>
                        )}
                        <ImportMenu
                          workspaceId={entry.id}
                          workspaceName={entry.name}
                          open={importMenu === entry.id}
                          onOpen={() =>
                            setImportMenu((open) => (open === entry.id ? null : entry.id))
                          }
                          onClose={() => setImportMenu(null)}
                          onImportFolder={() => {
                            setVaultTarget(entry);
                            vaultInput.current?.click();
                          }}
                          onImportZip={() => {
                            setVaultTarget(entry);
                            zipInput.current?.click();
                          }}
                          onOpenBackup={() => fileInput.current?.click()}
                          disabled={busy}
                        />
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
                            setRecents(
                              readRecentWorkspaces().map((row) =>
                                labelRecent(row, readWorkspaceNames()),
                              ),
                            );
                          }}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>

        <footer className="border-t border-[var(--hairline)] px-8 py-3 text-[11px] text-[var(--ink-muted)]">
          Fully open-source and MIT Licensed (c) {new Date().getFullYear()} Suite
        </footer>
      </div>
      {deleteTarget ? (
        <Suspense fallback={null}>
          <DeleteWorkspaceDialog
            mode="standalone"
            workspaceId={deleteTarget.id}
            title={deleteTarget.name}
            onClose={() => setDeleteTarget(null)}
            onDeleted={() => {
              forgetWorkspaceName(deleteTarget.id);
              setDeleteTarget(null);
              setRecents(
                readRecentWorkspaces().map((row) => labelRecent(row, readWorkspaceNames())),
              );
              navigateTo("/");
            }}
          />
        </Suspense>
      ) : null}
      {/* The same bubble the board carries. This is the screen somebody reaches when
          nothing works yet, and it is the only one a signed-out visitor sees, so
          leaving it to the board hid feedback from exactly the people most likely to
          send it. */}
      <SendFeedbackBubble surface="launcher" signedIn={account !== null} />
      {/* Before the list is usable, once per browser: alpha, what paying buys, and the one
          fact a new reader discovers too late, that an unclaimed workspace is this
          browser's copy. */}
      <AlphaNotice onSeePlans={() => useAccountStore.getState().openPanel("plan")} />
      {/* The import's report has nowhere else to go on this screen: the launcher
          is the whole page, so it mounts the one toast stack itself. */}
      <ToastLayer />
    </main>
  );
}
