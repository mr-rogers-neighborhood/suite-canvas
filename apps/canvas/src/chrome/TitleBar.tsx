import { useEffect, useRef, useState } from "react";
import type { AccountPhase } from "../auth/useAccountStore";
import { focusFirstMenuItem, menuKeyDown } from "../dialogs/menuKeys";
import { type SyncClaim, type SyncRefusal, syncPresentation } from "../feedback/syncState";
import { useEscapeLayer } from "../shell/escapeLayers";
import type { ConnectionStatus } from "../store/useCanvasStore";
import { ThemeToggle } from "../styles/ThemeToggle";
import { SyncPanel } from "./SyncPanel";

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
   * Who is behind this browser. A signed-out browser is local, not refused, and
   * the status control says so; `unknown` renders no action at all, so the first
   * paint cannot offer "Sign in" to someone who already is.
   */
  phase?: AccountPhase;
  /** What the account says about this workspace's membership in it. */
  claim?: SyncClaim;
  /** Why the relay refused, when it said. */
  reason?: SyncRefusal | null;
  /** The relay's name for this workspace, shown inside the storage details. */
  workspaceId?: string;
  /** Opens the sign-in dialog from the status panel's local reading. */
  onSignIn?: (() => void) | undefined;
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
  /**
   * Other workspaces this browser has open lately, with the current one already
   * removed. Switching here rather than through the launcher is the point of
   * making the title a menu: boards and workspaces are the same question.
   */
  otherWorkspaces?: readonly { id: string; title: string }[];
  /** Leaves this workspace for another one; the leave guard decides if it asks. */
  onOpenWorkspace?: (id: string) => void;
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

export function TitleBar({
  status,
  role,
  peerCount = 0,
  phase = "unknown",
  claim = "unknown",
  reason = null,
  workspaceId,
  onSignIn,
  storage,
  workspaceName,
  canRenameWorkspace = false,
  onRenameWorkspace,
  otherWorkspaces = [],
  onOpenWorkspace,
  children,
  actions,
  onNavigateHome,
  onOpenSearch,
}: TitleBarProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(workspaceName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [nameMenuOpen, setNameMenuOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!statusOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!statusRef.current?.contains(event.target as Node)) setStatusOpen(false);
    };
    // Capture, so a press on the board closes the panel even though React Flow
    // claims the press for the canvas.
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [statusOpen]);

  useEscapeLayer(() => setStatusOpen(false), statusOpen);
  useEscapeLayer(() => setNameMenuOpen(false), nameMenuOpen && !renaming);

  useEffect(() => {
    if (!nameMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!nameRef.current?.contains(event.target as Node)) setNameMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [nameMenuOpen]);

  // The button and the panel read one decision, so they cannot disagree.
  const presentation = syncPresentation({ phase, status, peerCount, role, claim, reason });

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
          <div className="relative" ref={nameRef}>
            <button
              type="button"
              data-testid="workspace-name"
              aria-haspopup="menu"
              aria-expanded={nameMenuOpen}
              title={`${workspaceName} — switch workspace`}
              className="workspace-name inline-flex max-w-[200px] items-center gap-1"
              onClick={() => setNameMenuOpen((open) => !open)}
            >
              <span className="min-w-0 truncate">{workspaceName}</span>
              <span aria-hidden="true" className="shrink-0 opacity-60">
                {"\u25be"}
              </span>
            </button>
            {nameMenuOpen ? (
              <div
                role="menu"
                aria-label="Workspace"
                data-testid="workspace-switcher"
                ref={focusFirstMenuItem}
                onKeyDown={menuKeyDown}
                className="absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 text-[12px] shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="workspace-switcher-rename"
                  disabled={!canRenameWorkspace}
                  className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                  onClick={() => {
                    setNameMenuOpen(false);
                    setDraft(workspaceName);
                    setError(null);
                    setRenaming(true);
                  }}
                >
                  Rename workspace
                </button>
                {otherWorkspaces.length > 0 && onOpenWorkspace ? (
                  <>
                    <hr className="my-1 border-[var(--hairline)]" />
                    <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                      Workspaces
                    </p>
                    {otherWorkspaces.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        role="menuitem"
                        data-testid={`workspace-switcher-open-${entry.id}`}
                        className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => {
                          setNameMenuOpen(false);
                          onOpenWorkspace(entry.id);
                        }}
                      >
                        <span className="min-w-0 truncate">{entry.title}</span>
                      </button>
                    ))}
                  </>
                ) : null}
                <hr className="my-1 border-[var(--hairline)]" />
                <button
                  type="button"
                  role="menuitem"
                  data-testid="workspace-switcher-home"
                  className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => {
                    setNameMenuOpen(false);
                    onNavigateHome?.();
                  }}
                >
                  Back to launcher
                </button>
              </div>
            ) : null}
          </div>
        )
      ) : null}
      {error ? (
        <span role="alert" className="workspace-name-error">
          {error}
        </span>
      ) : null}

      {children ? (
        // `flex-1` matters: sized by content, this box measured zero for a full
        // strip and its tabs slid under the controls beside it.
        <div className="ml-2 flex min-w-0 flex-1 items-center overflow-hidden">{children}</div>
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
            <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
            {presentation.label}
            {peerCount > 0 ? <span className="tabular-nums">· {peerCount + 1} here</span> : null}
          </button>
          {statusOpen ? (
            <SyncPanel
              status={status}
              phase={phase}
              claim={claim}
              reason={reason}
              peerCount={peerCount}
              {...(role === undefined ? {} : { role })}
              {...(workspaceId === undefined ? {} : { workspaceId })}
              {...(storage === undefined ? {} : { storage })}
              {...(onSignIn === undefined ? {} : { onSignIn })}
            />
          ) : null}
        </div>
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}
