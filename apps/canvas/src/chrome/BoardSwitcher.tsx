import { type Board, type SectionColor, sectionColors } from "@suite/graph";
import { useEffect, useMemo, useRef, useState } from "react";
import { focusFirstMenuItem, menuKeyDown } from "../dialogs/menuKeys";
import { IconPicker } from "../icons/IconPicker";
import { useEscapeLayer } from "../shell/escapeLayers";
import { BoardGlyph } from "./BoardGlyph";

/**
 * A board's colour dot, in the same six the palette starts from.
 *
 * The tokens are the sections' own, so "blue" is one blue across a wash, a swatch
 * and a dot — the alternative was a second palette that drifted.
 */
const SWATCH: Record<SectionColor, string> = {
  slate: "bg-[var(--section-slate)]",
  blue: "bg-[var(--section-blue)]",
  green: "bg-[var(--section-green)]",
  amber: "bg-[var(--section-amber)]",
  rose: "bg-[var(--section-rose)]",
  violet: "bg-[var(--section-violet)]",
};

/** Peers whose board is this one, named for the row's tooltip. */
export interface BoardPresence {
  label: string;
  color: string;
}

/** The switcher's two groups: what you pinned, then what you touched lately. */
export interface BoardGroups {
  pinned: Board[];
  recent: Board[];
}

/**
 * Orders the flat board list for the switcher: pins in the order they were
 * pinned, then everything else by this session's recency, then by when the board
 * last changed.
 *
 * There is no tree to walk. A portal is a link between two boards, so the only
 * sensible order is the reader's own — not a parentless hierarchy they would
 * have to learn.
 */
export function groupBoards(
  boards: readonly Board[],
  recency: readonly string[],
  pins: readonly string[],
): BoardGroups {
  const byId = new Map(boards.map((board) => [board.id, board]));
  const pinned = pins.flatMap((id) => {
    const board = byId.get(id);
    return board ? [board] : [];
  });
  const taken = new Set(pinned.map((board) => board.id));
  const rest = boards.filter((board) => !taken.has(board.id));
  const rank = new Map(recency.map((id, index) => [id, index]));
  const recent = [...rest].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  });
  return { pinned, recent };
}

export interface BoardSwitcherProps {
  /** Every board in the workspace. Flat: a board has no parent. */
  boards: readonly Board[];
  activeBoardId: string | null;
  /** Boards this session has been on, most recent first. */
  recency: readonly string[];
  /** Board ids the reader pinned in this browser. */
  pinned: readonly string[];
  onSelect: (boardId: string) => void;
  onCreate: () => void;
  /**
   * Opens the library, optionally on the boards themselves.
   *
   * "All boards…" is a request about boards, so it lands on the boards; every other way
   * in leaves the reader's own filters alone, because filters are a choice they already
   * made and a menu item is not the place to undo it.
   */
  onOpenLibrary: (facet?: "board") => void;
  onRename: (boardId: string, name: string) => void;
  onSetColor: (boardId: string, color: Board["color"] | null) => void;
  /** An icon reference painted in the board's colour; `null` clears it. */
  onSetIcon?: ((boardId: string, icon: string | null) => void) | undefined;
  onTogglePin: (boardId: string) => void;
  /**
   * A row menu another surface asked for — the pinned tabs, which are drawn in the bar
   * rather than here.
   *
   * The switcher owns the menu, so rename, icon, colour and pin have one implementation
   * whichever part of the bar the reader right-clicked.
   */
  rowMenuRequest?: { boardId: string; x: number; y: number } | null;
  /** Viewers and shares may switch boards but not rename or recolour one. */
  canManage?: boolean;
  /**
   * Whether there is anywhere to navigate to.
   *
   * `"workspace"` is the app: every board, plus the pins and the two ways in
   * (create one, or open the library on them). `"board"` is a reader who was handed
   * *one* board — a board-scope share — and for whom the list would hold exactly one
   * row, all of it disabled. They still need to know which board they are looking at,
   * so the same control renders as a label: where you are, offering nothing.
   */
  navigation?: "workspace" | "board";
  peersByBoard?: Record<string, BoardPresence>;
}

/**
 * The one navigation control in the bar: the board you are on, and every board
 * you could be on.
 *
 * It replaced a tab strip, a breadcrumb trail and two workspace settings that
 * each answered "how do I get to another board". Tabs needed a set to close,
 * rename and colour; a trail implied a hierarchy boards do not have; the
 * settings asked the reader to configure what a click should do. A switcher
 * answers the same question with one list (ADR-0064 amendment).
 */
export function BoardSwitcher({
  boards,
  activeBoardId,
  recency,
  pinned,
  onSelect,
  onCreate,
  onOpenLibrary,
  onRename,
  onSetColor,
  onSetIcon,
  onTogglePin,
  rowMenuRequest = null,
  canManage = true,
  navigation = "workspace",
  peersByBoard,
}: BoardSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ boardId: string; x: number; y: number } | null>(null);
  /** The board whose icon picker is open, if any. */
  const [iconFor, setIconFor] = useState<{ boardId: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const root = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(() => setRowMenu(null), rowMenu !== null);
  useEscapeLayer(() => setOpen(false), open && rowMenu === null);

  // A request from the bar: the list closes, because the menu it opened is about one
  // board and the list is about all of them.
  useEffect(() => {
    if (!rowMenuRequest) return;
    setOpen(false);
    setRowMenu(rowMenuRequest);
  }, [rowMenuRequest]);

  const active = boards.find((board) => board.id === activeBoardId) ?? null;
  const groups = useMemo(() => groupBoards(boards, recency, pinned), [boards, recency, pinned]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const commitRename = (boardId: string) => {
    const name = draft.trim();
    if (name.length > 0) onRename(boardId, name);
    setRenamingId(null);
  };

  const row = (board: Board) => {
    const current = board.id === activeBoardId;
    const presence = peersByBoard?.[board.id];
    if (renamingId === board.id) {
      return (
        <input
          // biome-ignore lint/a11y/noAutofocus: renaming a row is an explicit gesture
          autoFocus
          // The list can be longer than the panel: a rename from a pinned tab has to
          // bring its row into view, or the caret is focused somewhere the reader cannot
          // see.
          // Optional call: a test environment lays nothing out and has no such method.
          ref={(node) => node?.scrollIntoView?.({ block: "nearest" })}
          value={draft}
          aria-label={`Rename ${board.name}`}
          data-testid={`board-switch-rename-${board.id}`}
          className="w-full rounded-lg px-2 py-1.5 text-[12px] outline-none ring-1 ring-blue-400"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commitRename(board.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename(board.id);
            if (event.key === "Escape") setRenamingId(null);
          }}
        />
      );
    }
    return (
      <button
        type="button"
        role="menuitem"
        aria-current={current ? "page" : undefined}
        data-testid={`board-switch-${board.id}`}
        data-active={current ? "true" : undefined}
        title={presence ? `${board.name} — ${presence.label} here now` : board.name}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10 ${
          current ? "font-medium text-[var(--ink)]" : "text-[var(--ink-muted)]"
        }`}
        onClick={() => {
          setOpen(false);
          onSelect(board.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setRowMenu({ boardId: board.id, x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (event.key !== "F10" || !event.shiftKey) return;
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          setRowMenu({ boardId: board.id, x: box.left, y: box.bottom });
        }}
      >
        <BoardGlyph board={board} />
        <span className="min-w-0 flex-1 truncate">{board.name}</span>
        {presence ? (
          <span
            data-testid={`board-switch-peer-${board.id}`}
            role="img"
            aria-label={`${presence.label} here now`}
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: presence.color }}
          />
        ) : null}
      </button>
    );
  };

  // A single-board reader gets the name and nothing behind it: no list of one, no
  // "New board" they cannot use, no pin they do not own.
  if (navigation === "board") {
    return (
      <div className="relative min-w-0" ref={root} data-handbook-region="board-switcher">
        <span
          data-testid="board-switcher"
          title={active?.name ?? "No board"}
          className="inline-flex max-w-[220px] min-w-0 items-center gap-1.5 px-2 py-1 text-[12px] font-medium text-[var(--ink)]"
        >
          {active ? <BoardGlyph board={active} /> : null}
          <span className="min-w-0 truncate">{active?.name ?? "No board"}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="relative min-w-0" ref={root} data-handbook-region="board-switcher">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="board-switcher"
        aria-label={active ? `Board: ${active.name}` : "Choose a board"}
        title="Switch board"
        className="inline-flex max-w-[220px] min-w-0 items-center gap-1.5 rounded px-2 py-1 text-[12px] font-medium text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => setOpen((value) => !value)}
        // The switcher *is* the current board, so a right-click on it is a right-click on
        // that board: a second way to reach the same menu, not a second menu.
        onContextMenu={(event) => {
          if (!active) return;
          event.preventDefault();
          setOpen(false);
          setRowMenu({ boardId: active.id, x: event.clientX, y: event.clientY });
        }}
      >
        {active ? <BoardGlyph board={active} /> : null}
        <span className="min-w-0 truncate">{active?.name ?? "No board"}</span>
        <span aria-hidden="true" className="shrink-0 text-[var(--ink-muted)]">
          {"\u25be"}
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Boards"
          data-testid="board-switcher-menu"
          /* Not while a row is being renamed: the input inside it owns focus, and
             focusing the first item would blur it, which commits the draft and closes
             the rename the menu was opened for. */
          ref={renamingId === null ? focusFirstMenuItem : undefined}
          onKeyDown={menuKeyDown}
          className="absolute left-0 top-full z-50 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
        >
          {boards.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-[var(--ink-muted)]">
              This workspace has no boards yet.
            </p>
          ) : null}
          {groups.pinned.length > 0 ? (
            <>
              <GroupLabel>Pinned</GroupLabel>
              {groups.pinned.map((board) => (
                <div key={board.id}>{row(board)}</div>
              ))}
              <hr className="my-1 border-[var(--hairline)]" />
            </>
          ) : null}
          {groups.recent.length > 0 ? (
            <>
              {groups.pinned.length > 0 ? <GroupLabel>Recent</GroupLabel> : null}
              {groups.recent.map((board) => (
                <div key={board.id}>{row(board)}</div>
              ))}
              <hr className="my-1 border-[var(--hairline)]" />
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            data-testid="board-switcher-new"
            className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            New board
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="board-switcher-all"
            className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => {
              setOpen(false);
              onOpenLibrary("board");
            }}
          >
            All boards…
          </button>
        </div>
      ) : null}
      {iconFor === null ? null : (
        <>
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => setIconFor(null)}
            aria-hidden="true"
          />
          <div className="fixed z-50" style={{ left: iconFor.x, top: iconFor.y }}>
            <IconPicker
              value={boards.find((board) => board.id === iconFor.boardId)?.icon ?? null}
              onClose={() => setIconFor(null)}
              onPick={(icon) => {
                onSetIcon?.(iconFor.boardId, icon);
                setIconFor(null);
              }}
            />
          </div>
        </>
      )}
      {rowMenu === null ? null : (
        <RowMenu
          board={boards.find((board) => board.id === rowMenu.boardId) ?? null}
          position={{ x: rowMenu.x, y: rowMenu.y }}
          pinned={pinned.includes(rowMenu.boardId)}
          canManage={canManage}
          onDismiss={() => setRowMenu(null)}
          onRename={(board) => {
            // Renaming never navigates. The row menu can be opened from a pinned tab or
            // from the switcher itself, so the list is opened and *scrolled to that row*
            // with its input focused: the reader edits the name where names live, and the
            // board they are looking at stays the board they are looking at.
            setRowMenu(null);
            setOpen(true);
            setRenamingId(board.id);
            setDraft(board.name);
          }}
          onColor={(board, color) => {
            setRowMenu(null);
            onSetColor(board.id, color);
          }}
          onTogglePin={(board) => {
            setRowMenu(null);
            onTogglePin(board.id);
          }}
          {...(onSetIcon
            ? {
                onIcon: (board: Board) => {
                  const at = { x: rowMenu?.x ?? 0, y: rowMenu?.y ?? 0 };
                  setRowMenu(null);
                  setIconFor({ boardId: board.id, ...at });
                },
              }
            : {})}
        />
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
      {children}
    </p>
  );
}

/**
 * What a right-click on a board offers.
 *
 * Only the three things worth doing without leaving the bar: what it is called,
 * what colour it is, and whether it sits at the top. Everything else about a
 * board (delete, templates, its cards) belongs to the library, which stays the
 * one place that manages boards.
 */
function RowMenu({
  board,
  position,
  pinned,
  canManage,
  onDismiss,
  onRename,
  onColor,
  onTogglePin,
  onIcon,
}: {
  board: Board | null;
  position: { x: number; y: number };
  pinned: boolean;
  canManage: boolean;
  onDismiss: () => void;
  onRename: (board: Board) => void;
  onColor: (board: Board, color: Board["color"] | null) => void;
  onTogglePin: (board: Board) => void;
  /** Absent when this session cannot change the board's mark. */
  onIcon?: ((board: Board) => void) | undefined;
}) {
  if (board === null) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onDismiss} aria-hidden="true" />
      <div
        role="menu"
        aria-label={`${board.name} board`}
        data-testid="board-row-menu"
        ref={focusFirstMenuItem}
        onKeyDown={menuKeyDown}
        style={{ left: position.x, top: position.y }}
        className="fixed z-50 w-48 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 text-[12px] shadow-xl"
      >
        <button
          type="button"
          role="menuitem"
          data-testid="board-row-menu-pin"
          className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => onTogglePin(board)}
        >
          {pinned ? "Unpin" : "Pin to top"}
        </button>
        {onIcon ? (
          <button
            type="button"
            role="menuitem"
            data-testid="board-row-menu-icon"
            disabled={!canManage}
            className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
            onClick={() => onIcon(board)}
          >
            Icon…
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          data-testid="board-row-menu-rename"
          disabled={!canManage}
          className="flex w-full items-center rounded-lg px-2 py-1.5 text-left hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
          onClick={() => onRename(board)}
        >
          Rename
        </button>
        <hr className="my-1 border-[var(--hairline)]" />
        <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
          Colour
        </p>
        <div className="flex items-center gap-1 px-2 pb-1.5 pt-0.5">
          {sectionColors.map((color) => (
            <button
              key={color}
              type="button"
              role="menuitem"
              aria-label={color}
              disabled={!canManage}
              data-testid={`board-row-color-${color}`}
              className={`h-4 w-4 rounded-full disabled:opacity-40 ${SWATCH[color]} ${
                board.color === color ? "ring-2 ring-[var(--ink)] ring-offset-1" : ""
              }`}
              onClick={() => onColor(board, color)}
            />
          ))}
          <button
            type="button"
            role="menuitem"
            aria-label="No colour"
            disabled={!canManage}
            data-testid="board-row-color-none"
            className="ml-1 rounded px-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
            onClick={() => onColor(board, null)}
          >
            None
          </button>
        </div>
      </div>
    </>
  );
}
