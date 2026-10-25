import type { Board } from "@suite/graph";
import { useState } from "react";

/** Peers whose active board is this one, named for the tab's tooltip. */
export interface BoardPresence {
  label: string;
  color: string;
}

export interface BoardTabsProps {
  /** Boards with an open tab, in tab order; a closed board is still in the library. */
  boards: Board[];
  activeBoardId: string | null;
  onSelect: (boardId: string) => void;
  onCreate: () => void;
  onRename: (boardId: string, name: string) => void;
  /**
   * Closes the board's tab and nothing else: the board keeps its cards and stays
   * in the library, so this asks no question and writes no document.
   */
  onClose: (boardId: string) => void;
  /** Viewers and board/card shares may switch boards but not add one. */
  canCreateBoards?: boolean;
  /** Renaming a board belongs to the workspace surface, not a draft. */
  canManageBoards?: boolean;
  /** Cross-board presence, keyed by board id; no transport of its own. */
  peersByBoard?: Record<string, BoardPresence>;
}

/** Board switcher in the app bar: one tab per open board, plus create. */
export function BoardTabs({
  boards,
  activeBoardId,
  onSelect,
  onCreate,
  onRename,
  onClose,
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

  return (
    // The tablist owns the tab buttons and nothing else; the close control and
    // the "new board" button sit beside it instead of inside a tab.
    <div className="group flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
      <div
        className="board-tabs flex min-w-0 items-center gap-1"
        role="tablist"
        aria-label="Boards"
      >
        {boards.map((board) => {
          const active = board.id === activeBoardId;
          const presence = peersByBoard?.[board.id];
          if (renamingId === board.id) {
            return (
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
            );
          }
          return (
            <span key={board.id} className="inline-flex min-w-0 items-center">
              <button
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
              <button
                type="button"
                aria-label={`Close ${board.name}`}
                data-testid={`board-close-${board.id}`}
                title={`Close the ${board.name} tab`}
                className="-ml-0.5 shrink-0 rounded px-1 text-[11px] leading-none text-[var(--ink-muted)] transition-colors hover:bg-black/[0.06] hover:text-[var(--ink)] dark:hover:bg-white/15"
                onClick={() => onClose(board.id)}
              >
                {"\u00d7"}
              </button>
            </span>
          );
        })}
      </div>

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
