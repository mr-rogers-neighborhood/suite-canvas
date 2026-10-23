import type { Board } from "@suite/graph";
import { useState } from "react";

/** Peers whose active board is this one, named for the tab's tooltip. */
export interface BoardPresence {
  label: string;
  color: string;
}

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
  /** Cross-board presence, keyed by board id; no transport of its own. */
  peersByBoard?: Record<string, BoardPresence>;
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
  peersByBoard,
}: BoardTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commit = () => {
    if (renamingId) onRename(renamingId, draft);
    setRenamingId(null);
  };

  const activeBoard = boards.find((board) => board.id === activeBoardId);

  return (
    // The tablist owns the tabs and nothing else; the per-board delete and the
    // "new board" button live beside it instead of inside it.
    <div className="group flex min-w-0 items-center gap-1">
      <div
        className="board-tabs flex min-w-0 items-center gap-1"
        role="tablist"
        aria-label="Boards"
      >
        {boards.map((board) => {
          const active = board.id === activeBoardId;
          const presence = peersByBoard?.[board.id];
          return renamingId === board.id ? (
            <input
              key={board.id}
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
              key={board.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`board-tab-${board.id}`}
              data-active={active ? "true" : undefined}
              title={canManageBoards ? "Double-click to rename" : board.name}
              className={`inline-flex max-w-[140px] items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors ${
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
              <span className="min-w-0 truncate">{board.name}</span>
              {presence ? (
                <span
                  data-testid="board-tab-peer-dot"
                  className="board-tab-peer-dot"
                  role="img"
                  aria-label={`${presence.label} here now`}
                  title={`${presence.label} here now`}
                  style={{ backgroundColor: presence.color }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {canManageBoards && activeBoard ? (
        <button
          type="button"
          aria-label={`Delete ${activeBoard.name}`}
          className="shrink-0 rounded px-1 text-[11px] text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-black/5 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10"
          onClick={() => onDeleteRequest(activeBoard.id)}
        >
          {"\u00d7"}
        </button>
      ) : null}

      {canCreateBoards ? (
        <button
          type="button"
          aria-label="New board"
          data-testid="board-create"
          className="shrink-0 rounded px-2 py-1 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onCreate}
        >
          +
        </button>
      ) : null}
    </div>
  );
}
