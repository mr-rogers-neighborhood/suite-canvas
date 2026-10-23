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
  documentId?: string;
  /** Board switcher, rendered between the document id and the status. */
  children?: React.ReactNode;
  /** Workspace-level actions (share, export), rendered before the status. */
  actions?: React.ReactNode;
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
  documentId,
  children,
  actions,
}: TitleBarProps) {
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
        className="flex items-center hover:opacity-70"
      >
        <img src="/suite-logo-black.svg" alt="" className="h-6 w-auto dark:hidden" />
        <img src="/suite-logo-white.svg" alt="" className="hidden h-6 w-auto dark:block" />
      </a>

      {documentId ? (
        <span className="truncate text-[11px] text-[var(--ink-muted)]">{documentId}</span>
      ) : null}

      {children ? <div className="ml-2 flex min-w-0 items-center">{children}</div> : null}

      <div className="ml-auto flex items-center gap-3">
        {actions}
        <span
          data-testid="sync-status"
          data-role={role}
          className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
          {statusLabel}
          {peerCount > 0 ? <span className="tabular-nums">· {peerCount + 1} here</span> : null}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
