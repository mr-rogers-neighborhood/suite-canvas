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
   * Opens the plan tab from the status panel's capped reading.
   *
   * This was passed into this component by the shell and never declared here, and a JSX
   * spread is not excess-checked, so it was silently dropped: the panel's "See plans"
   * button rendered and did nothing. Declaring it is the whole fix.
   */
  onSeePlans?: (() => void) | undefined;
  /** Asks the control plane about this workspace again, for the reader who just paid. */
  onReclaim?: (() => void) | undefined;
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
  /**
   * Whether this workspace is pinned in this browser, and the one action that changes it.
   *
   * A workspace pin is the same gesture as a board pin with a smaller promise: it lifts
   * the workspace to the top of this list and the launcher, and it earns no tab, because
   * the tab strip belongs to the board you are on.
   */
  workspacePinned?: boolean;
  onToggleWorkspacePin?: ((workspaceId: string) => void) | undefined;
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
  onSeePlans,
  onReclaim,
  storage,
  workspaceName,
  canRenameWorkspace = false,
  onRenameWorkspace,
  otherWorkspaces = [],
  onOpenWorkspace,
  workspacePinned = false,
  onToggleWorkspacePin,
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
  /** Where a right click on the name opened its menu, if it did. */
  const [nameMenuAt, setNameMenuAt] = useState<{ x: number; y: number } | null>(null);
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
  useEscapeLayer(() => setNameMenuAt(null), nameMenuAt !== null);

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
    <header
      className="app-bar relative z-20 flex h-11 shrink-0 items-center gap-3 px-4"
      data-handbook-region="title-bar"
    >
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
              data-handbook-region="workspace-name"
              aria-haspopup="menu"
              aria-expanded={nameMenuOpen}
              title={`${workspaceName} — switch workspace`}
              className="workspace-name inline-flex max-w-[200px] items-center gap-1"
              onClick={() => setNameMenuOpen((open) => !open)}
              // The same menu the board name has: a right click is a shortcut to the
              // two things worth doing to a workspace without leaving the page.
              onContextMenu={(event) => {
                event.preventDefault();
                setNameMenuOpen(false);
                setNameMenuAt({ x: event.clientX, y: event.clientY });
              }}
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
                {workspaceId && onToggleWorkspacePin ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="workspace-switcher-pin"
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => {
                      setNameMenuOpen(false);
                      onToggleWorkspacePin(workspaceId);
                    }}
                  >
                    {workspacePinned ? "Unpin workspace" : "Pin workspace to top"}
                  </button>
                ) : null}
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
            {nameMenuAt === null ? null : (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onPointerDown={() => setNameMenuAt(null)}
                  aria-hidden="true"
                />
                <div
                  role="menu"
                  aria-label="Workspace"
                  data-testid="workspace-name-menu"
                  ref={focusFirstMenuItem}
                  onKeyDown={menuKeyDown}
                  style={{ left: nameMenuAt.x, top: nameMenuAt.y }}
                  className="fixed z-50 w-48 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 text-[12px] shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="workspace-name-menu-rename"
                    disabled={!canRenameWorkspace}
                    className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                    onClick={() => {
                      setNameMenuAt(null);
                      setDraft(workspaceName);
                      setError(null);
                      setRenaming(true);
                    }}
                  >
                    Rename workspace
                  </button>
                  {workspaceId && onToggleWorkspacePin ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="workspace-name-menu-pin"
                      className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => {
                        setNameMenuAt(null);
                        onToggleWorkspacePin(workspaceId);
                      }}
                    >
                      {workspacePinned ? "Unpin workspace" : "Pin workspace to top"}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )
      ) : null}
      {error ? (
        <span role="alert" className="workspace-name-error">
          {error}
        </span>
      ) : null}

      {children ? (
        // `flex-initial`, not `flex-1`: the bar's spare width belongs to search.
        // A growing box here split the slack with it, which is why the search
        // field stopped short of the empty space next to it.
        // No `overflow-hidden` here: the board list opens downward from this
        // row, and clipping it to the 44px bar left a dropdown with one visible
        // row. Nothing in this row scrolls horizontally any more, so there is
        // nothing to clip.
        <div className="ml-2 flex min-w-0 flex-initial items-center">{children}</div>
      ) : null}

      {onOpenSearch ? (
        <button
          type="button"
          data-testid="command-bar"
          data-handbook-region="command-bar"
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
            data-handbook-region="sync-status"
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
              {...(onSeePlans === undefined ? {} : { onSeePlans })}
              {...(onReclaim === undefined ? {} : { onReclaim })}
            />
          ) : null}
        </div>
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}
