import { useState } from "react";
import type { ConnectionStatus } from "../store/useCanvasStore";
import { ThemeToggle } from "./ThemeToggle";

export type TitleBarRole = "editor" | "viewer";

export interface TitleBarProps {
  status: ConnectionStatus;
  /**
   * Present on a share link: the connected slot then names what the reader can
   * do instead of claiming a live editing session.
   */
  role?: TitleBarRole;
  peerCount?: number;
  /** The workspace's own label; a share passes its scope label instead. */
  workspaceName?: string;
  canRenameWorkspace?: boolean;
  /** Returns a readable error, or null when the rename was accepted. */
  onRenameWorkspace?: (name: string) => string | null;
  /** Board switcher and saved views, rendered after the workspace name. */
  children?: React.ReactNode;
  /** Workspace-level actions (share, export), rendered before the theme. */
  actions?: React.ReactNode;
  /** Intercepts the brand link so the shell can animate before leaving. */
  onNavigateHome?: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Live",
  connecting: "Syncing",
  // Back from offline and pushing the local edits; the same amber as a first
  // sync, because it is the same "catching up" state.
  rejoining: "Reconnecting",
  disconnected: "Offline",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-400",
  rejoining: "bg-amber-400",
  disconnected: "bg-gray-400 dark:bg-gray-500",
};

export function TitleBar({
  status,
  role,
  peerCount = 0,
  workspaceName,
  canRenameWorkspace = false,
  onRenameWorkspace,
  children,
  actions,
  onNavigateHome,
}: TitleBarProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(workspaceName ?? "");
  const [error, setError] = useState<string | null>(null);
  const statusLabel =
    status === "connected" && role
      ? role === "viewer"
        ? "Viewer"
        : "Editor"
      : STATUS_LABEL[status];

  return (
    <header className="app-bar relative z-20 flex h-11 shrink-0 items-center gap-3 px-4">
      <a
        href="/"
        aria-label="Back to workspace launcher"
        className="flex shrink-0 items-center hover:opacity-70"
        onClick={(event) => {
          if (!onNavigateHome) return;
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          onNavigateHome();
        }}
      >
        <img src="/suite-logo-black.svg" alt="" className="h-6 w-auto dark:hidden" />
        <img src="/suite-logo-white.svg" alt="" className="hidden h-6 w-auto dark:block" />
      </a>

      {workspaceName ? (
        renaming ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: the label is an explicit rename gesture
            autoFocus
            value={draft}
            aria-label="Workspace name"
            data-testid="workspace-name-input"
            className="workspace-name-input"
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onBlur={() => {
              const problem = onRenameWorkspace?.(draft) ?? null;
              if (problem) {
                setError(problem);
                return;
              }
              setRenaming(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                setRenaming(false);
                setDraft(workspaceName);
                setError(null);
              }
            }}
          />
        ) : (
          <button
            type="button"
            data-testid="workspace-name"
            title={canRenameWorkspace ? "Rename workspace" : workspaceName}
            className="workspace-name"
            onClick={() => {
              if (!canRenameWorkspace) return;
              setDraft(workspaceName);
              setError(null);
              setRenaming(true);
            }}
          >
            {workspaceName}
          </button>
        )
      ) : null}
      {error ? (
        <span role="alert" className="workspace-name-error">
          {error}
        </span>
      ) : null}

      {children ? <div className="ml-2 flex min-w-0 flex-1 items-center">{children}</div> : null}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <span
          data-testid="sync-status"
          data-role={role}
          className="inline-flex h-6 items-center gap-1.5 text-[11px] leading-none text-[var(--ink-muted)]"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
          {statusLabel}
          {peerCount > 0 ? <span className="tabular-nums">· {peerCount + 1} here</span> : null}
        </span>
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}
