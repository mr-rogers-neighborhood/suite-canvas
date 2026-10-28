import type { Board } from "@suite/graph";
import { useMemo, useState } from "react";

export interface StartPageProps {
  /** Every board in the workspace, so the list is the workspace and not a tab set. */
  boards: readonly Board[];
  /** Boards with cards on them, for the one line under each name. */
  cardCounts?: Readonly<Record<string, number>>;
  onOpen: (boardId: string) => void;
  onCreate: () => void;
  canCreate?: boolean;
}

/** How many boards the list shows before it says to search instead. */
const LIST_LIMIT = 8;

const RECENT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * The workspace with no board open: the pane you land on after closing your last
 * tab, or when you ask for a new tab in a workspace that names no board for one.
 *
 * It exists because the alternative was worse in both directions. Reopening a
 * board the reader had just closed ignored a deliberate act; a blank canvas with
 * a `+` made them find the library to discover what they already had. So this is
 * the one question worth asking here — which board? — with the boards listed,
 * searchable and one keystroke from opening.
 */
export function StartPage({
  boards,
  cardCounts = {},
  onOpen,
  onCreate,
  canCreate = true,
}: StartPageProps) {
  const [query, setQuery] = useState("");

  const recent = useMemo(
    () =>
      [...boards]
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .slice(0, LIST_LIMIT),
    [boards],
  );
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? boards.filter((board) => board.name.toLowerCase().includes(needle)).slice(0, LIST_LIMIT)
    : recent;

  return (
    <div
      data-testid="start-page"
      className="pointer-events-auto w-full max-w-[420px] rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-xl"
    >
      <p className="text-[14px] font-semibold">Open a board</p>
      <p className="mt-1 text-[12px] leading-5 text-[var(--ink-muted)]">
        Every board in this workspace, most recent first.
      </p>
      <input
        // biome-ignore lint/a11y/noAutofocus: the pane exists to be typed into
        autoFocus
        type="search"
        value={query}
        aria-label="Find a board"
        placeholder="Find a board"
        data-testid="start-page-search"
        className="mt-3 w-full rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--ink-muted)]"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const first = shown[0];
          if (first) onOpen(first.id);
        }}
      />
      <ul className="mt-2 max-h-[240px] overflow-y-auto" data-testid="start-page-list">
        {shown.map((board) => {
          const count = cardCounts[board.id] ?? 0;
          return (
            <li key={board.id}>
              <button
                type="button"
                data-testid={`start-page-board-${board.id}`}
                className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => onOpen(board.id)}
              >
                <span className="min-w-0 flex-1 truncate text-[12px]">{board.name}</span>
                <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                  {count === 1 ? "1 card" : `${count} cards`}
                  {board.updatedAt ? ` · ${RECENT.format(board.updatedAt)}` : ""}
                </span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="px-2 py-3 text-[12px] text-[var(--ink-muted)]">No board by that name.</li>
        ) : null}
      </ul>
      {canCreate ? (
        <button
          type="button"
          data-testid="start-page-new"
          className="mt-3 w-full rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-[var(--surface)] hover:opacity-90"
          onClick={onCreate}
        >
          New board
        </button>
      ) : null}
    </div>
  );
}
