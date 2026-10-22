import { useEffect, useRef, useState } from "react";
import {
  downloadWorkspaceBackup,
  downloadWorkspaceJson,
  downloadWorkspaceMarkdown,
  workspaceUrl,
} from "../session/workspaceTransfer";
import { useCanvasStore } from "../store/useCanvasStore";

export interface WorkspaceActionsProps {
  workspaceId: string;
  boardId: string | null;
  title: string;
}

/**
 * The workspace-level actions that belong in the app bar: copy the share link,
 * export the exact backup, and return to the launcher. Import lives on the
 * launcher so it can never merge into the open document.
 */
export function WorkspaceActions({ workspaceId, boardId, title }: WorkspaceActionsProps) {
  const workspace = useCanvasStore((state) => state.workspace);
  const flush = useCanvasStore((state) => state.flush);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);

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

  const share = async () => {
    setError(null);
    const url = workspaceUrl(workspaceId, boardId);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the link. Copy the address bar instead.");
    }
  };

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
        onClick={() => void share()}
        title="Copy a link to this board. Anyone with the link can edit."
      >
        {copied ? "Copied" : "Share"}
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
    </div>
  );
}
