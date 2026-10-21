import type { ConnectionStatus } from "../store/useCanvasStore";
import { ThemeToggle } from "./ThemeToggle";

export interface TitleBarProps {
  status: ConnectionStatus;
  peerCount?: number;
  documentId?: string;
  /** Board switcher, rendered between the document id and the status. */
  children?: React.ReactNode;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Live",
  connecting: "Syncing",
  disconnected: "Offline",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-400",
  disconnected: "bg-gray-400 dark:bg-gray-500",
};

export function TitleBar({ status, peerCount = 0, documentId, children }: TitleBarProps) {
  return (
    <header className="app-bar relative z-20 flex h-11 shrink-0 items-center gap-3 px-4">
      <span className="text-[13px] font-semibold tracking-tight">Suite</span>

      {documentId ? (
        <span className="truncate text-[11px] text-[var(--ink-muted)]">{documentId}</span>
      ) : null}

      {children ? <div className="ml-2 flex min-w-0 items-center">{children}</div> : null}

      <div className="ml-auto flex items-center gap-3">
        <span
          data-testid="sync-status"
          className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
          {STATUS_LABEL[status]}
          {peerCount > 0 ? <span className="tabular-nums">· {peerCount + 1} here</span> : null}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
