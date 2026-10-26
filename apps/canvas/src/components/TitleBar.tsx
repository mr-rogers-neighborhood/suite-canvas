import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "../store/useCanvasStore";
import { ThemeToggle } from "./ThemeToggle";

export type TitleBarRole = "editor" | "viewer";

export interface TitleBarProps {
  status: ConnectionStatus;
  /**
   * Present on a share link. It is not a sync state, so it reads inside the status
   * panel rather than in the chrome, which answers "is anyone else here".
   */
  role?: TitleBarRole;
  peerCount?: number;
  /**
   * What this device can say about its own copy, shown under the sync indicator.
   * Absent when the host has no storage surface to offer.
   */
  storage?: React.ReactNode;
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
  /**
   * The command bar's trigger. It fills whatever the tabs and the status group
   * leave free and opens the command palette, so the bar has one search surface
   * instead of a second, parallel one.
   */
  onOpenSearch?: (() => void) | undefined;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Synced",
  connecting: "Syncing",
  // Back from offline and pushing the local edits: the same word as a first sync,
  // because it is the same "catching up" state, and the panel says which one it is.
  rejoining: "Syncing",
  disconnected: "Offline",
};

/** The room, in one sentence: how many people, and whether it is going anywhere. */
function roomSentence(status: ConnectionStatus, peerCount: number, role?: TitleBarRole): string {
  if (status === "disconnected") {
    return "Working offline. This tab keeps working; a reload will not.";
  }
  if (status === "connecting") return "Connecting to the relay.";
  if (status === "rejoining") return "Back online, catching up with the room.";
  if (role !== undefined) {
    return role === "viewer"
      ? "You are viewing this workspace."
      : "You are editing this workspace.";
  }
  return peerCount === 0 ? "You are the only one here." : `${peerCount + 1} here, including you.`;
}

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
  storage,
  workspaceName,
  canRenameWorkspace = false,
  onRenameWorkspace,
  children,
  actions,
  onNavigateHome,
  onOpenSearch,
}: TitleBarProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(workspaceName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!statusOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!statusRef.current?.contains(event.target as Node)) setStatusOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStatusOpen(false);
    };
    // Capture, so a press on the board closes the panel even though React Flow
    // claims the press for the canvas.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [statusOpen]);

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

      {children ? (
        <div className="ml-2 flex min-w-0 shrink items-center overflow-hidden">{children}</div>
      ) : null}

      {onOpenSearch ? (
        <button
          type="button"
          data-testid="command-bar"
          aria-label="Search or run a command"
          aria-keyshortcuts="Meta+K Control+K"
          title="Search or run a command (⌘K)"
          onClick={onOpenSearch}
          className="command-bar"
        >
          <span aria-hidden="true" className="command-bar__glyph">
            {"\u2315"}
          </span>
          <span className="command-bar__label">{"Search or jump to\u2026"}</span>
          <kbd className="command-bar__key">{"\u2318K"}</kbd>
        </button>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="relative" ref={statusRef}>
          <button
            type="button"
            data-testid="sync-status"
            data-status={status}
            data-role={role}
            aria-expanded={statusOpen}
            aria-haspopup="dialog"
            title="Sync, people and storage"
            className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setStatusOpen((value) => !value)}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
            {STATUS_LABEL[status]}
            {peerCount > 0 ? <span className="tabular-nums">· {peerCount + 1} here</span> : null}
          </button>
          {statusOpen ? (
            <div
              data-testid="sync-panel"
              role="dialog"
              aria-label="Sync and storage"
              className="absolute top-7 right-0 z-50 w-[320px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 text-[12px] shadow-lg"
            >
              <h2 className="text-[13px] font-semibold text-[var(--ink)]">Sync</h2>
              <p data-testid="sync-room" className="mt-2 leading-5 text-[var(--ink)]">
                {roomSentence(status, peerCount, role)}
              </p>
              {storage ? (
                <div className="mt-3 border-t border-[var(--hairline)] pt-3">{storage}</div>
              ) : null}
            </div>
          ) : null}
        </div>
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}
