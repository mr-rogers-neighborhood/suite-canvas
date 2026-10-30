import type { ReactNode } from "react";

/** The scrolling list: the rows and the empty state. */
export function LibraryList({
  tab,
  boardScope,
  searching,
  query,
  filtering,
  entryCount,
  truncated,
  rows,
}: {
  tab: string;
  boardScope: boolean;
  searching: boolean;
  query: string;
  filtering: boolean;
  entryCount: number;
  /** The search stopped at its cap, so more matches exist than are listed. */
  truncated: boolean;
  rows: ReactNode;
}) {
  return (
    <div className="library-list overflow-y-auto p-1.5">
      {truncated ? (
        <p
          data-testid="library-search-truncated"
          className="px-2 py-1 text-[11px] text-[var(--ink-muted)]"
        >
          Showing the first 200 matches. Add a word to narrow them.
        </p>
      ) : null}
      {/* "Start from" lives in the launcher, where a workspace begins. Here the
          library lists what you already have. */}
      {entryCount === 0 ? (
        <p
          className="px-2 py-6 text-center text-[12px] text-[var(--ink-muted)]"
          {...(searching ? { "data-testid": "library-search-empty" } : {})}
        >
          {emptyLabel({ tab, searching, filtering, boardScope, query })}
        </p>
      ) : (
        rows
      )}
    </div>
  );
}

function emptyLabel({
  tab,
  searching,
  filtering,
  boardScope,
  query,
}: {
  tab: string;
  searching: boolean;
  filtering: boolean;
  boardScope: boolean;
  query: string;
}): string {
  if (searching) return `No cards match \u201c${query.trim()}\u201d.`;
  if (filtering) return "No cards match these filters.";
  if (tab === "inbox") {
    return "Nothing in the inbox. A card that is on no board lands here.";
  }
  if (tab === "cards") return boardScope ? "Nothing on this board yet." : "Nothing here yet.";
  return "Trash is empty.";
}
