import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { LibrarySort } from "./useLibraryList";

/** The query box; the drawer owns the focus ref and the keyboard cursor. */
export function LibrarySearchRow({
  inputRef,
  query,
  onQuery,
  onNavigate,
  onPick,
  enabled,
  sort,
  onSort,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  /** The Boards tab searches boards, so the labels change. */
  onQuery: (query: string) => void;
  /** Arrow keys move the row cursor while a search is active. */
  onNavigate: (step: 1 | -1) => void;
  onPick: () => void;
  /** Only an active search takes arrow keys and Enter. */
  enabled: boolean;
  /** The list's order; relevance only means something while a query is active. */
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!enabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      onNavigate(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onPick();
    }
  };

  return (
    <div className="library-search flex items-center gap-1.5 border-b border-[var(--hairline)] px-2 py-1.5">
      <span aria-hidden="true" className="text-[12px] text-[var(--ink-muted)]">
        {"\u2315"}
      </span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        data-testid="library-search"
        aria-label="Search cards and boards"
        placeholder="Search cards and boards"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--ink-muted)]"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <select
        data-testid="library-sort"
        aria-label="Sort the library"
        value={sort}
        onChange={(event) => onSort(event.target.value as LibrarySort)}
        className="shrink-0 rounded border border-[var(--hairline)] bg-[var(--surface)] px-1 py-0.5 text-[11px] text-[var(--ink-muted)]"
      >
        <option value="title">Title</option>
        <option value="updated">Recently updated</option>
        <option value="relevance">Relevance</option>
      </select>
      {query.length > 0 ? (
        <button
          type="button"
          aria-label="Clear search"
          data-testid="library-search-clear"
          className="library-action"
          onClick={() => onQuery("")}
        >
          {"\u00d7"}
        </button>
      ) : null}
    </div>
  );
}
