import { STARTER_TEMPLATES, type WorkspaceTemplate } from "@suite/graph";
import type { VaultFile } from "@suite/import-obsidian";
import { LoroDoc } from "loro-crdt";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LoroIndexeddbPersistence } from "../collab/loroPersistence";
import { ToastLayer } from "../feedback/ToastLayer";
import { toast } from "../feedback/toast";
import { desktopBridge, hostKind } from "../host/bridge";
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
import { DesktopRecents } from "./DesktopRecents";
import { RepositoryButton, RepositoryFooter, SavedLocallyPrompt } from "./LauncherChrome";
import { type RecentEntry, RecentWorkspaceRow } from "./RecentWorkspaceRow";
import {
  DEFAULT_STARTER_TEMPLATE_ID,
  loadStarterTemplates,
  rememberChosenTemplate,
  starterTemplateById,
} from "./starterTemplates";
import { VaultImportDialog } from "./VaultImportDialog";
import {
  importVaultIntoNewWorkspace,
  importVaultIntoWorkspace,
  vaultFilesFromPicker,
  vaultName,
} from "./vaultImport";
import { readVaultZip } from "./vaultZip";

/** The workspace name leads the row; the last board name is only a fallback. */
function labelRecent(
  entry: RecentWorkspace,
  names: Record<string, string>,
  fallback = entry.title,
): RecentEntry {
  return { ...entry, name: resolveWorkspaceName(names[entry.id], fallback) };
}

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
  // `null` until the account answers, and stays `null` when there is no session.

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

  // One surface, two capability sets: a shell owns the file, a browser owns the
  // storage. Asking the host keeps the two in one component instead of two
  // launchers that drift.
  const isDesktop = hostKind() === "desktop";

  /**
   * Begin a new canvas.
   *
   * Two hosts, two meanings, and the difference is not cosmetic. A browser owns the
   * storage, so a new workspace is a URL and a reload. A desktop shell owns the *file*,
   * and the session comes from whatever it has open — so navigating would reload the
   * launcher and change nothing, which is exactly what it used to do. On the desktop the
   * shell is asked to make a document instead.
   *
   * The remembered template is keyed by workspace id and read on boot, so both paths get
   * the starter applied by the same code.
   */
  const startNew = async () => {
    const workspaceId = newWorkspaceId();
    const chosen = starterTemplateById(templates, template);
    // `?template=` carries an id, and an id only resolves a starter this bundle was
    // built with. The chosen template therefore travels as itself as well, which is
    // the only way a starter that came from the server can be applied at all.
    if (chosen !== undefined) rememberChosenTemplate(workspaceId, chosen);
    // A starter names the workspace as well as its board: on the desktop the
    // workspace name is what the file is called, so a template that left it
    // "Untitled workspace" would produce `Untitled workspace.canvas`.
    const title = chosen?.name ?? DEFAULT_WORKSPACE_NAME;
    rememberWorkspace({ id: workspaceId, title });
    if (chosen !== undefined) rememberWorkspaceName(workspaceId, title);

    const bridge = desktopBridge();
    if (bridge !== null) {
      setProgress("Creating\u2026");
      try {
        const made = await bridge.createDocument({
          workspaceId,
          title,
          // An empty document, as this app writes one. Main places it and opens the
          // window on it; the remembered template is applied by the boot path.
          snapshot: new LoroDoc().export({ mode: "snapshot" }),
          manifest: { boards: 0, cards: 0, types: 0, tags: 0 },
        });
        // A shell that says why is the difference between "nothing happened" and a
        // sentence a person can act on.
        if (!made.ok) {
          setError(`Could not create that canvas: ${made.reason}`);
          setProgress(null);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not create that canvas.");
        setProgress(null);
      }
      return;
    }

    const url = new URL(workspaceUrl(workspaceId, null));
    url.searchParams.set("fresh", "1");
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

  /**
   * Import a vault with no workspace chosen, which is the home's own case.
   *
   * The document is built here and then stored by whichever host owns storage:
   * the browser keeps it under the new id, the shell writes it as a file. The
   * import runs once, so the two hosts cannot produce different documents.
   */
  const importVaultHome = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const { files, name } = await vaultFilesFromPicker(list);
    if (files.length === 0) {
      setError("Nothing was imported: that folder holds no notes or canvases.");
      return;
    }

    const workspaceId = newWorkspaceId();
    setProgress(`Importing ${name ?? "vault"}\u2026`);
    setError(null);
    setNotice(null);
    try {
      const { outcome, document } = importVaultIntoNewWorkspace({
        workspaceId,
        files,
        ...(name === undefined ? {} : { homeBoardName: name }),
      });
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }

      const title = name ?? DEFAULT_WORKSPACE_NAME;
      const bridge = desktopBridge();
      if (bridge !== null) {
        // The shell creates the file from this document, then moves the window
        // onto it; the import is already inside the snapshot it is handed.
        await bridge.saveDocument({
          workspaceId,
          title,
          snapshot: new Uint8Array(document.exportSnapshot()),
          manifest: {
            boards: document.listBoards().length,
            cards: document.listCards().length,
            types: document.listTypes().length,
            tags: document.listTags().length,
          },
        });
      } else {
        const doc = document.doc;
        const persistence = new LoroIndexeddbPersistence(workspaceId, doc);
        try {
          await persistence.open();
          await persistence.compact();
        } finally {
          persistence.destroy();
        }
        rememberWorkspace({ id: workspaceId, title, boardId: outcome.boardId ?? null });
        rememberWorkspaceName(workspaceId, title);
        openWorkspace(workspaceId, outcome.boardId ?? null);
      }

      toast.success(outcome.message, {
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import that folder.");
    } finally {
      setProgress(null);
    }
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
      // Anchored to the top, not centred. A home surface that floats in the
      // middle drifts every time the window is resized, and a card taller than a
      // short window could not centre at all: it clipped 36px off the bottom at
      // 480px. The container scrolls instead, so the whole surface stays reachable.
      className="workspace-launcher min-h-screen overflow-y-auto bg-[var(--canvas-bg)] px-4 py-10 text-[var(--ink)]"
      // A vault is dropped on a row, never on the page. Claiming the drag here
      // stops the browser from navigating to the dropped file when someone
      // misses a row, which would lose the launcher instead of doing nothing.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <div className="mx-auto w-[min(760px,100%)] overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.55)]">
        <header className="border-b border-[var(--hairline)] px-8 pt-8 pb-7">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-[34px] font-semibold tracking-tight">Suite</h1>
              {/* Two sentences and a rule between them. A `div` rather than a `p`: an `<hr>`
                  is flow content and cannot live inside a paragraph, so a `p` would close
                  before it and the second line would lose the muted 13px styling. */}
              <div className="mt-1 max-w-[420px] text-[13px] leading-5 text-[var(--ink-muted)]">
                <p>A canvas for connected thinking.</p>
                <hr className="my-2 border-[var(--hairline)]" />
                <p>Open a canvas file, pick up a recent one, or choose a starter template.</p>
              </div>
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
              New canvas
            </button>
            <button
              type="button"
              data-testid="launcher-import"
              className="rounded-lg border border-[var(--hairline)] px-4 py-2 text-[13px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                // On the desktop the shell owns the file, so its dialog opens it in
                // place. The browser's input would import a copy as a new
                // IndexedDB workspace, which is the wrong thing for a file-first
                // build.
                const bridge = desktopBridge();
                if (bridge === null) {
                  fileInput.current?.click();
                  return;
                }
                void bridge.openFileDialog();
              }}
              disabled={busy}
            >
              Open canvas file…
            </button>
            <button
              type="button"
              data-testid="launcher-vault"
              className="rounded-lg border border-[var(--hairline)] px-4 py-2 text-[13px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => vaultInput.current?.click()}
              disabled={busy}
            >
              Import a vault…
            </button>
            <RepositoryButton />
            <input
              ref={fileInput}
              type="file"
              accept=".canvas,.suite,.json,application/json"
              className="hidden"
              data-testid="launcher-file"
              onChange={(event) => {
                void importFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <VaultImportDialog
              vaultInputRef={(element) => {
                vaultInput.current = element;
                if (element) element.webkitdirectory = true;
              }}
              onImportHome={importVaultHome}
              zipInputRef={zipInput}
              vaultTarget={vaultTarget}
              onClearTarget={() => setVaultTarget(null)}
              onImportFolder={importVaultFolder}
              onImportZip={importVaultZip}
            />
            {/* Identity lives here as well as in the title bar: this is the first
                screen someone sees, and an account is what keeps a workspace
                across devices. The literal keeps every byte of `/api/auth` out of
                a standalone build. */}
          </div>
          {/* Notebook is the default rather than Blank: a new workspace should open
              with somewhere to write, and an empty document is still one choice
              away. It sits on its own line because it belongs to "New canvas",
              not beside it, and the description follows the choice rather than
              stretching the select until the name is cut off. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ink-muted)]">
            <label className="flex items-center gap-2">
              <span>New from</span>
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

        {isDesktop ? (
          <section className="px-8 py-6" aria-labelledby="recent-title">
            <h2 id="recent-title" className="text-[12px] font-semibold uppercase tracking-wide">
              Recent files
            </h2>
            <DesktopRecents />
          </section>
        ) : null}

        <section className={isDesktop ? "hidden" : "px-8 py-6"} aria-labelledby="recent-title">
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

          {recents.length > 0 ? <SavedLocallyPrompt /> : null}

          {recents.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-[var(--hairline)] px-4 py-8 text-center text-[13px] text-[var(--ink-muted)]">
              Nothing here yet. Start a new workspace or open a <code>.canvas</code> file.
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
                  {shown.map((entry) => (
                    <RecentWorkspaceRow
                      key={entry.id}
                      entry={entry}
                      renaming={renamingId === entry.id}
                      draft={draft}
                      nameError={nameError}
                      dropping={dropTargetId === entry.id}
                      busy={busy}
                      importMenuOpen={importMenu === entry.id}
                      onDragOver={(event) => {
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
                      onDraftChange={(value) => {
                        setDraft(value);
                        setNameError(null);
                      }}
                      onCommitRename={(target) => void commitRename(target)}
                      onCancelRename={() => {
                        renameCancelled.current = true;
                        setRenamingId(null);
                        setNameError(null);
                      }}
                      onOpenWorkspace={(id, boardId) => openWorkspace(id, boardId)}
                      onStartRename={(target) => startRename(target)}
                      onToggleImportMenu={() =>
                        setImportMenu((open) => (open === entry.id ? null : entry.id))
                      }
                      onCloseImportMenu={() => setImportMenu(null)}
                      onImportFolder={() => {
                        setVaultTarget(entry);
                        vaultInput.current?.click();
                      }}
                      onImportZip={() => {
                        setVaultTarget(entry);
                        zipInput.current?.click();
                      }}
                      onOpenBackup={() => fileInput.current?.click()}
                      onExport={(target) => void exportRecent(target)}
                      onDeleteTarget={
                        import.meta.env.VITE_SUITE_MODE === "standalone"
                          ? (target) => setDeleteTarget(target)
                          : undefined
                      }
                      onForget={(target) => {
                        forgetWorkspace(target.id);
                        setRecents(
                          readRecentWorkspaces().map((row) =>
                            labelRecent(row, readWorkspaceNames()),
                          ),
                        );
                      }}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <RepositoryFooter />
      </div>
      {deleteTarget ? (
        <Suspense fallback={null}>
          <DeleteWorkspaceDialog
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
      {/* Before the list is usable: alpha, what paying buys, and the one fact a new reader
          discovers too late, that an unclaimed workspace is this browser's copy. A dismissal
          stands for ten minutes, so a visit the next day reads it again. */}
      <AlphaNotice />
      {/* The import's report has nowhere else to go on this screen: the launcher
          is the whole page, so it mounts the one toast stack itself. */}
      <ToastLayer />
    </main>
  );
}
