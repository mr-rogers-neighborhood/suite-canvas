import type { DragEvent } from "react";
import { syncLabelOf, syncStateOf } from "../session/accountWorkspaces";
import type { RecentWorkspace } from "../session/workspaceTransfer";
import { ImportMenu } from "./ImportMenu";
import { RenameWorkspaceDialog } from "./RenameWorkspaceDialog";

export interface RecentEntry extends RecentWorkspace {
  name: string;
}

export interface RecentWorkspaceRowProps {
  entry: RecentEntry;
  renaming: boolean;
  draft: string;
  nameError: string | null;
  dropping: boolean;
  account: Parameters<typeof syncStateOf>[1];
  busy: boolean;
  importMenuOpen: boolean;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLLIElement>) => void;
  onDraftChange: (draft: string) => void;
  onCommitRename: (entry: RecentEntry) => void;
  onCancelRename: () => void;
  onOpenWorkspace: (id: string, boardId: string | null) => void;
  onStartRename: (entry: RecentEntry) => void;
  onToggleImportMenu: () => void;
  onCloseImportMenu: () => void;
  onImportFolder: () => void;
  onImportZip: () => void;
  onOpenBackup: () => void;
  onExport: (entry: RecentEntry) => void;
  onDeleteTarget?: ((entry: RecentEntry) => void) | undefined;
  onForget: (entry: RecentEntry) => void;
}

function openedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RecentWorkspaceRow({
  entry,
  renaming,
  draft,
  nameError,
  dropping,
  account,
  busy,
  importMenuOpen,
  onDragOver,
  onDragLeave,
  onDrop,
  onDraftChange,
  onCommitRename,
  onCancelRename,
  onOpenWorkspace,
  onStartRename,
  onToggleImportMenu,
  onCloseImportMenu,
  onImportFolder,
  onImportZip,
  onOpenBackup,
  onExport,
  onDeleteTarget,
  onForget,
}: RecentWorkspaceRowProps) {
  // The board name repeats the workspace name until someone names
  // the workspace, so it only earns space when it differs.
  const board = entry.title?.trim();
  const detail = [board && board !== entry.name ? board : null, entry.boardId]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  return (
    <li
      data-testid={`launcher-recent-${entry.id}`}
      data-drop-target={dropping ? "vault" : undefined}
      className={`group flex items-center gap-3 py-2.5 ${
        dropping ? "rounded-lg bg-black/5 ring-1 ring-blue-400 dark:bg-white/10" : ""
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {renaming ? (
        <RenameWorkspaceDialog
          entry={entry}
          draft={draft}
          nameError={nameError}
          onDraftChange={onDraftChange}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onOpenWorkspace(entry.id, entry.boardId ?? null)}
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
          onClick={() => onStartRename(entry)}
          disabled={busy}
        >
          Rename
        </button>
      )}
      <ImportMenu
        workspaceId={entry.id}
        workspaceName={entry.name}
        open={importMenuOpen}
        onOpen={onToggleImportMenu}
        onClose={onCloseImportMenu}
        onImportFolder={onImportFolder}
        onImportZip={onImportZip}
        onOpenBackup={onOpenBackup}
        disabled={busy}
      />
      <button
        type="button"
        data-testid={`launcher-export-${entry.id}`}
        className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/10"
        onClick={() => onExport(entry)}
        disabled={busy}
      >
        Export
      </button>
      {onDeleteTarget ? (
        <button
          type="button"
          data-testid={`launcher-delete-${entry.id}`}
          aria-label="Delete this workspace…"
          title="Delete this workspace…"
          className="rounded-md px-2 py-1 text-[11px] text-red-600 opacity-0 transition-opacity hover:bg-red-50 group-hover:opacity-100 focus:opacity-100 dark:text-red-300 dark:hover:bg-red-500/15"
          onClick={() => onDeleteTarget(entry)}
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
        onClick={() => onForget(entry)}
      >
        ×
      </button>
    </li>
  );
}
