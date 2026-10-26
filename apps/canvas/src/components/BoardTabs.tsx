import type { Board } from "@suite/graph";
import { useEffect, useRef, useState } from "react";
import { useEscapeLayer } from "../shell/escapeLayers";

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
  /**
   * Boards with no open tab, so `+` can open one instead of only making one.
   * Empty is fine: the chooser then offers "New board" alone.
   */
  openableBoards?: readonly Board[];
  /** The board `+` opens directly, when the workspace named one (ADR-0040, A24). */
  newTabBoardId?: string | null;
  /** The board a workspace opens when nothing else is open, named in its menu. */
  homeBoardId?: string | null;
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
  openableBoards = [],
  newTabBoardId = null,
  homeBoardId = null,
  onRename,
  onClose,
  canCreateBoards = true,
  canManageBoards = true,
  peersByBoard,
}: BoardTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooser = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(() => setChooserOpen(false), chooserOpen);

  useEffect(() => {
    if (!chooserOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!chooser.current?.contains(event.target as Node)) setChooserOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [chooserOpen]);

  const commit = () => {
    if (renamingId) onRename(renamingId, draft);
    setRenamingId(null);
  };

  return (
    /*
     * A navigation, not a tablist.
     *
     * These were `role="tablist"` / `role="tab"` siblings of a close button and a rename
     * field, which axe reports as `aria-required-children`: the tablist's children have to
     * be tabs, and a per-tab close control cannot be one. The strict-tablist fix would
     * have moved closing out of the tab strip entirely, losing an affordance every reader
     * expects; the honest mapping is this one — switching a board replaces the canvas, it
     * does not reveal a panel on the same page, so `aria-current` is the right word for
     * "you are here" and the strip is free to hold what it needs (ADR-0064 amendment).
     */
    <div className="group flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
      {homeBoardId && homeBoardId !== activeBoardId ? (
        <button
          type="button"
          aria-label="Open the home board"
          data-testid="board-home"
          title="Home board"
          className="shrink-0 rounded px-1.5 py-1 text-[12px] leading-none text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
          onClick={() => onSelect(homeBoardId)}
        >
          {"\u2302"}
        </button>
      ) : null}
      <nav className="board-tabs flex min-w-0 items-center gap-1" aria-label="Boards">
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
                aria-current={active ? "page" : undefined}
                data-testid={`board-tab-${board.id}`}
                data-active={active ? "true" : undefined}
                title={canManageBoards ? "Double-click to rename" : board.name}
                className={`board-tab inline-flex max-w-[140px] items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors ${
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
      </nav>

      {canCreateBoards ? (
        <div className="relative shrink-0" ref={chooser}>
          {/*
            `+` asks which board, because "a new tab" and "a new board" were the
            same button and only one of them was ever the reader's intent. A
            workspace may name the board it always wants (`newTabBoardId`), and
            then the button opens it without asking.
          */}
          <button
            type="button"
            aria-label={newTabBoardId ? "Open the board new tabs open" : "New board or open one"}
            aria-haspopup={newTabBoardId ? undefined : "menu"}
            aria-expanded={newTabBoardId ? undefined : chooserOpen}
            data-testid="board-create"
            className="rounded px-2 py-1 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => {
              if (newTabBoardId) {
                onSelect(newTabBoardId);
                return;
              }
              setChooserOpen((open) => !open);
            }}
          >
            +
          </button>
          {chooserOpen && !newTabBoardId ? (
            <div
              role="menu"
              aria-label="Open or create a board"
              data-testid="board-chooser"
              className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
            >
              {openableBoards.length > 0 ? (
                <>
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                    Open
                  </p>
                  {openableBoards.map((board) => (
                    <button
                      key={board.id}
                      type="button"
                      role="menuitem"
                      data-testid={`board-chooser-open-${board.id}`}
                      className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => {
                        setChooserOpen(false);
                        onSelect(board.id);
                      }}
                    >
                      <span className="min-w-0 truncate">{board.name}</span>
                    </button>
                  ))}
                  <hr className="my-1 border-[var(--hairline)]" />
                </>
              ) : null}
              <button
                type="button"
                role="menuitem"
                data-testid="board-chooser-new"
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setChooserOpen(false);
                  onCreate();
                }}
              >
                New board
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
