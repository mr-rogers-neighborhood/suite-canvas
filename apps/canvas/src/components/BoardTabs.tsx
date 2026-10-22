import type { Board } from "@suite/graph";
import { useState } from "react";

export interface BoardTabsProps {
  boards: Board[];
  activeBoardId: string | null;
  onSelect: (boardId: string) => void;
  onCreate: () => void;
  onRename: (boardId: string, name: string) => void;
  onDeleteRequest: (boardId: string) => void;
  /** Viewers and board/card shares may switch boards but not add one. */
  canCreateBoards?: boolean;
  /** Renaming and deleting a board belongs to the workspace surface, not a draft. */
  canManageBoards?: boolean;
}

/** Board switcher in the app bar: one tab per board, plus create and delete. */
export function BoardTabs({
  boards,
  activeBoardId,
  onSelect,
  onCreate,
  onRename,
  onDeleteRequest,
  canCreateBoards = true,
  canManageBoards = true,
}: BoardTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commit = () => {
    if (renamingId) onRename(renamingId, draft);
    setRenamingId(null);
  };

  return (
    <div className="flex min-w-0 items-center gap-1" role="tablist" aria-label="Boards">
      {boards.map((board) => {
        const active = board.id === activeBoardId;
        return (
          <div key={board.id} className="group flex min-w-0 items-center">
            {renamingId === board.id ? (
              <input
                // biome-ignore lint/a11y/noAutofocus: inline rename is an explicit gesture
                autoFocus
                value={draft}
                aria-label={`Rename ${board.name}`}
                className="w-28 rounded px-2 py-1 text-[12px] outline-none ring-1 ring-blue-400"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit();
                  if (event.key === "Escape") setRenamingId(null);
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`board-tab-${board.id}`}
                data-active={active ? "true" : undefined}
                title={canManageBoards ? "Double-click to rename" : board.name}
                className={`max-w-[140px] truncate rounded px-2 py-1 text-[12px] transition-colors ${
                  active
                    ? "bg-black/[0.07] font-medium text-[var(--ink)] dark:bg-white/15"
                    : "text-[var(--ink-muted)] hover:bg-black/[0.04] dark:hover:bg-white/10"
                }`}
                onClick={() => onSelect(board.id)}
                onDoubleClick={() => {
                  if (!canManageBoards) return;
                  setRenamingId(board.id);
                  setDraft(board.name);
                }}
              >
                {board.name}
              </button>
            )}
            {active && canManageBoards ? (
              <button
                type="button"
                aria-label={`Delete ${board.name}`}
                className="rounded px-1 text-[11px] text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-black/5 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10"
                onClick={() => onDeleteRequest(board.id)}
              >
                {"\u00d7"}
              </button>
            ) : null}
          </div>
        );
      })}

      {canCreateBoards ? (
        <button
          type="button"
          aria-label="New board"
          data-testid="board-create"
          className="rounded px-2 py-1 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onCreate}
        >
          +
        </button>
      ) : null}
    </div>
  );
}
