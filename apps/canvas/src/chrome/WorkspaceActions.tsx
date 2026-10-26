import { useEffect, useRef, useState } from "react";
import { DeleteWorkspaceDialog } from "../dialogs/DeleteWorkspaceDialog";
import { menuKeyDown } from "../dialogs/menuKeys";
import { useCardTitle } from "../hooks/useCardContainers";
import { hasSavedRecoveryKey, readSavedRecoveryKey } from "../session/ownerKit";
import { getSession, isShareSession } from "../session/session";
import type { ShareScope } from "../session/shares";
import {
  downloadWorkspaceBackup,
  downloadWorkspaceJson,
  downloadWorkspaceMarkdown,
  navigateTo,
} from "../session/workspaceTransfer";
import { RecoveryKeyDialog } from "../sharing/RecoveryKeyDialog";
import { ShareDialog } from "../sharing/ShareDialog";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * Share management and the owner file need the relay. Every branch below tests
 * `import.meta.env.VITE_SUITE_MODE` literally — Vite inlines it at build time, so
 * a standalone build drops the branch and the `/api/shares` and `/api/workspaces`
 * clients behind it, while the File menu with export stays. A constant or an
 * `isStandalone()` call would be opaque to the bundler.
 */
export interface WorkspaceActionsProps {
  workspaceId: string;
  boardId: string | null;
  title: string;
  /**
   * Leaving for the launcher, when the shell wants to intercept it
   * (ADR-0025 amendment).
   * Without it this menu navigates directly, which is right for a surface that has
   * nothing to warn about.
   */
  onLeave?: (() => void) | undefined;
  /** Opens the named style rules. Absent for a surface that may not manage them. */
  onOpenStyles?: (() => void) | undefined;
}

/**
 * The workspace-level actions that belong in the app bar: share the workspace, a
 * board or a card, export the exact backup, and return to the launcher. Import
 * lives on the launcher so it can never merge into the open document.
 */
export function WorkspaceActions({
  workspaceId,
  boardId,
  title,
  onLeave,
  onOpenStyles,
}: WorkspaceActionsProps) {
  const workspace = useCanvasStore((state) => state.workspace);
  const flush = useCanvasStore((state) => state.flush);
  const inspectorNodeId = useUiStore((state) => state.inspectorNodeId);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const shareRequest = useUiStore((state) => state.shareRequest);
  const clearShareRequest = useUiStore((state) => state.clearShareRequest);
  const [menuOpen, setMenuOpen] = useState(false);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  // Read at render rather than kept as a copy: these live in the document, and
  // this menu is the only place that writes them, so closing it re-reads them.
  const isHomeBoard = activeBoardId !== null && workspace.workspaceHomeBoardId() === activeBoardId;
  const isNewTabBoard = activeBoardId !== null && workspace.newTabBoardId() === activeBoardId;
  useEscapeLayer(() => setMenuOpen(false), menuOpen);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>("workspace");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [backupPrompt, setBackupPrompt] = useState(false);
  const [savedOnDevice, setSavedOnDevice] = useState(() => readSavedRecoveryKey(workspaceId));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const canManageLinks = useUiStore((state) => state.canManageLinks);
  const ownerKey = getSession().ownerKey ?? "";
  // One delete entry per profile: the owner key can delete the relay copy, and
  // a standalone build can delete the only copy there is. A share session
  // returns null above, so neither ever renders for a link holder.
  const canDeleteWorkspace =
    import.meta.env.VITE_SUITE_MODE === "standalone" || (canManageLinks && ownerKey.length > 0);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // A canvas gesture asks for the dialog without lifting selection state.
  useEffect(() => {
    if (!shareRequest) return;
    setShareScope(shareRequest);
    setShareOpen(true);
    clearShareRequest();
  }, [shareRequest, clearShareRequest]);

  // The dialog shares one card: the inspected one, or a lone selection.
  const soleSelection = selectedNodeIds.length === 1 ? (selectedNodeIds[0] ?? null) : null;
  const selectedCardId = inspectorNodeId ?? soleSelection;
  const selectedCardIds = [...new Set(selectedNodeIds)];
  const selectedCardTitle = useCardTitle(selectedCardId ?? "");

  const goHome = async () => {
    setMenuOpen(false);
    await flush();
    if (onLeave) onLeave();
    else window.location.assign("/");
  };

  const exportTo = async (kind: "backup" | "json" | "markdown") => {
    setError(null);
    setNotice(null);
    try {
      if (kind === "backup") {
        // The warning lands before the file is written, and never cancels it:
        // a large or incomplete backup is still better than no backup. The
        // message carries the real size, or the cards whose images are missing.
        await downloadWorkspaceBackup(workspaceId, workspace, title, {
          onWarning: (message) => setNotice(message),
        });
        // A backup is exactly the moment someone should also save the key, so
        // this single prompt is the only export-time follow-up.
        if (!hasSavedRecoveryKey(workspaceId)) setBackupPrompt(true);
      } else if (kind === "json") downloadWorkspaceJson(workspace, title);
      else downloadWorkspaceMarkdown(workspace, title);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export this workspace.");
    }
  };

  // A share session has no workspace-level chrome: a workspace editor token
  // edits the live document but never sees this menu. Everything below is
  // local or owner-only, so a standalone build keeps the export menu even
  // though it has no links to manage.
  if (isShareSession()) return null;

  return (
    <div className="flex items-center gap-1" data-testid="workspace-actions">
      <div className="relative flex h-6 items-center" ref={menu}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="workspace-menu"
          className="inline-flex h-6 items-center rounded-md px-2 text-[11px] leading-none text-[var(--ink-muted)] transition-colors hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
          title="What you can do with this workspace."
          onClick={() => {
            setSavedOnDevice(readSavedRecoveryKey(workspaceId));
            setMenuOpen((open) => !open);
          }}
        >
          Workspace
        </button>
        {menuOpen ? (
          <div
            role="menu"
            data-testid="workspace-menu-list"
            onKeyDown={menuKeyDown}
            className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
          >
            {canManageLinks && import.meta.env.VITE_SUITE_MODE !== "standalone" ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="workspace-menu-share"
                  className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => {
                    setMenuOpen(false);
                    setShareScope("workspace");
                    setShareOpen(true);
                  }}
                >
                  Share this workspace…
                </button>
                <hr className="my-1 border-[var(--hairline)]" />
              </>
            ) : null}
            <button
              type="button"
              role="menuitem"
              data-testid="workspace-export-backup"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                setMenuOpen(false);
                void exportTo("backup");
              }}
            >
              Export backup…
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="workspace-export-json"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                setMenuOpen(false);
                void exportTo("json");
              }}
            >
              Export JSON…
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="workspace-export-markdown"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                setMenuOpen(false);
                void exportTo("markdown");
              }}
            >
              Export Markdown…
            </button>
            <hr className="my-1 border-[var(--hairline)]" />
            {onOpenStyles ? (
              <button
                type="button"
                role="menuitem"
                data-testid="workspace-styles"
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenStyles();
                }}
              >
                Styles…
              </button>
            ) : null}
            {ownerKey && import.meta.env.VITE_SUITE_MODE !== "standalone" ? (
              <button
                type="button"
                role="menuitem"
                data-testid="workspace-recovery-key"
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setMenuOpen(false);
                  setRecoveryOpen(true);
                }}
              >
                Owner file…
                {savedOnDevice ? (
                  <span
                    className="ml-auto pl-2 text-[10px] text-[var(--ink-muted)]"
                    data-testid="workspace-recovery-saved"
                  >
                    Saved on this device
                  </span>
                ) : null}
              </button>
            ) : null}
            <hr className="my-1 border-[var(--hairline)]" />
            {/* Navigation lives here because it is a fact about the workspace, not
                about the board on screen: which board is home, and which one a new
                tab opens (ADR-0040, gate A24). */}
            {activeBoardId ? (
              <button
                type="button"
                role="menuitem"
                data-testid="workspace-home-board"
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setMenuOpen(false);
                  workspace.setWorkspaceHomeBoardId(isHomeBoard ? null : activeBoardId);
                }}
              >
                {isHomeBoard ? "Stop using this board as home" : "Use this board as home"}
              </button>
            ) : null}
            {activeBoardId ? (
              <button
                type="button"
                role="menuitem"
                data-testid="workspace-new-tab-board"
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setMenuOpen(false);
                  workspace.setNewTabBoardId(isNewTabBoard ? null : activeBoardId);
                }}
              >
                {isNewTabBoard
                  ? "Stop opening this board in new tabs"
                  : "Open this board in new tabs"}
              </button>
            ) : null}
            <hr className="my-1 border-[var(--hairline)]" />
            <button
              type="button"
              role="menuitem"
              data-testid="workspace-home"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => void goHome()}
            >
              Back to launcher
            </button>
            {/* Destructive last: the row a reader should reach by leaving the
                rest behind, at the bottom of the menu. */}
            {canDeleteWorkspace ? (
              <button
                type="button"
                role="menuitem"
                data-testid="workspace-delete"
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/15"
                onClick={() => {
                  setMenuOpen(false);
                  setDeleteOpen(true);
                }}
              >
                Delete this workspace…
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <span
          role="alert"
          className="max-w-[220px] truncate text-[11px] text-red-600 dark:text-red-300"
          title={error}
        >
          {error}
        </span>
      ) : null}
      {notice ? (
        <span
          role="status"
          data-testid="workspace-export-notice"
          className="max-w-[320px] text-[11px] leading-snug text-[var(--ink-muted)]"
          title={notice}
        >
          {notice}
        </span>
      ) : null}
      {canDeleteWorkspace && deleteOpen ? (
        <DeleteWorkspaceDialog
          workspaceId={workspaceId}
          title={title}
          mode={import.meta.env.VITE_SUITE_MODE === "standalone" ? "standalone" : "relay"}
          ownerKey={ownerKey}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false);
            // The relay copy and this browser's copy are both gone; there is
            // nothing left to open, so the launcher is the only safe place.
            navigateTo("/");
          }}
        />
      ) : null}
      {/* Share and recovery are relay surfaces: one build-time gate keeps both
          dialogs — and the relay clients they import — out of a standalone build. */}
      {import.meta.env.VITE_SUITE_MODE !== "standalone" ? (
        <>
          {canManageLinks && shareOpen ? (
            <ShareDialog
              workspaceId={workspaceId}
              boardId={boardId}
              boardName={boardId ? title : null}
              cardId={selectedCardId}
              cardTitle={selectedCardId ? selectedCardTitle : null}
              selectedCardIds={selectedCardIds}
              initialScope={shareScope}
              onClose={() => {
                setShareOpen(false);
                setShareScope("workspace");
              }}
            />
          ) : null}
          {ownerKey && recoveryOpen ? (
            <RecoveryKeyDialog
              workspaceId={workspaceId}
              ownerKey={ownerKey}
              boardId={boardId}
              title={title}
              onClose={() => {
                setRecoveryOpen(false);
                setSavedOnDevice(readSavedRecoveryKey(workspaceId));
              }}
            />
          ) : null}
          {ownerKey && backupPrompt ? (
            <RecoveryKeyDialog
              mode="backup-prompt"
              workspaceId={workspaceId}
              ownerKey={ownerKey}
              title={title}
              onClose={() => {
                setBackupPrompt(false);
                setSavedOnDevice(readSavedRecoveryKey(workspaceId));
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
