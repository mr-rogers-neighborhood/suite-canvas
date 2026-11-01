import { useCallback, useEffect, useMemo, useState } from "react";
import type { OpenedBook } from "../archive/epub/open";
import { sanitiseChapter } from "../archive/epub/sanitise";
import { type BookText, indexBook, scrollToHit, searchBook } from "./bookSearch";

/**
 * A book's words, searchable.
 *
 * Two jobs that belong together and nowhere else: reading the book once so a keystroke is a scan rather than a hundred
 * chapter reads, and holding the hit a reader asked for until its chapter is the one on the page. The scroll itself is
 * the caller's, because the root element is the reader's.
 */
export interface PendingHit {
  readonly path: string;
  readonly match: string;
  readonly occurrence: number;
}

export interface BookSearchHost {
  readonly query: string;
  readonly setQuery: (value: string) => void;
  /** True while the book is still being read, which on a large one is long enough to need saying. */
  readonly indexing: boolean;
  readonly results: ReturnType<typeof searchBook>;
  readonly goTo: (path: string, match: string, occurrence: number) => void;
  /**
   * Lands the pending hit if it belongs to the chapter drawn in `root`, and reports whether it did.
   *
   * Called from an effect rather than from the press, because a result is a page turn and a scroll and the two land in
   * different commits.
   */
  readonly settle: (root: HTMLElement | null, markupPath: string, hasMarkup: boolean) => boolean;
}

export function useBookSearch(book: OpenedBook | null): BookSearchHost {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<BookText | null>(null);
  const [pending, setPending] = useState<PendingHit | null>(null);

  useEffect(() => {
    if (book === null) return;
    let cancelled = false;
    const titles = new Map(
      book.book.toc.flatMap((entry) =>
        entry.path === null ? [] : [[entry.path, entry.label] as const],
      ),
    );
    void indexBook(
      book.chapters,
      (path) => book.readChapter(path),
      (xml, path) => sanitiseChapter(xml, path),
      (path) => titles.get(path) ?? null,
    ).then((built) => {
      if (!cancelled) setIndex(built);
    });
    return () => {
      cancelled = true;
    };
  }, [book]);

  const results = useMemo(
    () => (index === null ? { chapters: [], total: 0 } : searchBook(index, query)),
    [index, query],
  );

  const goTo = useCallback((path: string, match: string, occurrence: number) => {
    setPending({ path, match, occurrence });
  }, []);

  const settle = useCallback(
    (root: HTMLElement | null, markupPath: string, hasMarkup: boolean): boolean => {
      // Guarded on the chapter: a hit's words may well appear in the chapter on the page too, and landing on them would be
      // a confident jump to the wrong place.
      if (pending === null || !hasMarkup || markupPath !== pending.path) return false;
      if (!scrollToHit(root, pending.match, pending.occurrence)) return false;
      setPending(null);
      return true;
    },
    [pending],
  );

  return { query, setQuery, indexing: index === null, results, goTo, settle };
}
