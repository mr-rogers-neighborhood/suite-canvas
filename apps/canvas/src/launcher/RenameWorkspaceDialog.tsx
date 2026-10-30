import type { RecentWorkspace } from "../session/workspaceTransfer";

export interface RenameWorkspaceDialogProps {
  entry: RecentWorkspace & { name: string };
  draft: string;
  nameError: string | null;
  onDraftChange: (draft: string) => void;
  onCommit: (entry: RecentWorkspace & { name: string }) => void;
  onCancel: () => void;
}

/**
 * Inline rename field and validation hint for a workspace in the launcher.
 */
export function RenameWorkspaceDialog({
  entry,
  draft,
  nameError,
  onDraftChange,
  onCommit,
  onCancel,
}: RenameWorkspaceDialogProps) {
  return (
    <div className="min-w-0 flex-1">
      <input
        // biome-ignore lint/a11y/noAutofocus: inline rename is an explicit gesture
        autoFocus
        data-testid={`launcher-rename-input-${entry.id}`}
        aria-label={`Rename ${entry.name}`}
        aria-invalid={nameError ? true : undefined}
        value={draft}
        className="w-full rounded bg-transparent px-1 text-[13px] font-medium leading-5 outline-none ring-1 ring-blue-400"
        onChange={(event) => onDraftChange(event.target.value)}
        onBlur={() => onCommit(entry)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
      />
      <span
        data-testid={`launcher-rename-hint-${entry.id}`}
        role={nameError ? "alert" : undefined}
        className={`block truncate text-[11px] leading-4 ${
          nameError ? "text-red-600 dark:text-red-300" : "text-[var(--ink-muted)]"
        }`}
      >
        {nameError ?? "Enter to save · Escape to cancel"}
      </span>
    </div>
  );
}
