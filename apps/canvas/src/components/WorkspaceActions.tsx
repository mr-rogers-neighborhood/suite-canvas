import { useEffect, useRef, useState } from "react";
import { useCardTitle } from "../hooks/useCardContainers";
import { hasSavedRecoveryKey } from "../session/ownerKit";
import { getSession } from "../session/session";
import {
  downloadWorkspaceBackup,
  downloadWorkspaceJson,
  downloadWorkspaceMarkdown,
} from "../session/workspaceTransfer";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { RecoveryKeyDialog } from "./RecoveryKeyDialog";
import { ShareDialog } from "./ShareDialog";

export interface WorkspaceActionsProps {
  workspaceId: string;
  boardId: string | null;
  title: string;
}

/**
 * The workspace-level actions that belong in the app bar: share the workspace, a
 * board or a card, export the exact backup, and return to the launcher. Import
 * lives on the launcher so it can never merge into the open document.
 */
export function WorkspaceActions({ workspaceId, boardId, title }: WorkspaceActionsProps) {
  const workspace = useCanvasStore((state) => state.workspace);
  const flush = useCanvasStore((state) => state.flush);
  const inspectorNodeId = useUiStore((state) => state.inspectorNodeId);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [backupPrompt, setBackupPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const ownerKey = getSession().ownerKey ?? "";

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

  // The dialog shares one card: the inspected one, or a lone selection.
  const soleSelection = selectedNodeIds.length === 1 ? (selectedNodeIds[0] ?? null) : null;
  const selectedCardId = inspectorNodeId ?? soleSelection;
  const selectedCardTitle = useCardTitle(selectedCardId ?? "");

  const goHome = async () => {
    setMenuOpen(false);
    await flush();
    window.location.assign("/");
  };

  const exportTo = (kind: "backup" | "json" | "markdown") => {
    setError(null);
    try {
      if (kind === "backup") downloadWorkspaceBackup(workspaceId, workspace, title);
      else if (kind === "json") downloadWorkspaceJson(workspace, title);
      else downloadWorkspaceMarkdown(workspace, title);
      // A backup is exactly the moment someone should also save the key, so
      // this single prompt is the only export-time follow-up.
      if (kind === "backup" && !hasSavedRecoveryKey(workspaceId)) setBackupPrompt(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export this workspace.");
    }
  };

  return (
    <div className="flex items-center gap-1" data-testid="workspace-actions">
      <button
        type="button"
        data-testid="workspace-share"
        className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] transition-colors hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
        onClick={() => setShareOpen(true)}
        title="Share this workspace, a board or a card."
      >
        Share
      </button>
      <div className="relative" ref={menu}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="workspace-file"
          className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] transition-colors hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
          onClick={() => setMenuOpen((open) => !open)}
        >
          File
        </button>
        {menuOpen ? (
          <div
            role="menu"
            data-testid="workspace-file-menu"
            className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="workspace-export-backup"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                setMenuOpen(false);
                exportTo("backup");
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
                exportTo("json");
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
                exportTo("markdown");
              }}
            >
              Export Markdown…
            </button>
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
              Recovery key…
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="workspace-home"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => void goHome()}
            >
              Back to launcher
            </button>
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
      {shareOpen ? (
        <ShareDialog
          workspaceId={workspaceId}
          boardId={boardId}
          boardName={boardId ? title : null}
          cardId={selectedCardId}
          cardTitle={selectedCardId ? selectedCardTitle : null}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      {ownerKey && recoveryOpen ? (
        <RecoveryKeyDialog
          workspaceId={workspaceId}
          ownerKey={ownerKey}
          title={title}
          onClose={() => setRecoveryOpen(false)}
        />
      ) : null}
      {ownerKey && backupPrompt ? (
        <RecoveryKeyDialog
          mode="backup-prompt"
          workspaceId={workspaceId}
          ownerKey={ownerKey}
          title={title}
          onClose={() => setBackupPrompt(false)}
        />
      ) : null}
    </div>
  );
}
