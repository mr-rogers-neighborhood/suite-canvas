import { useEffect, useRef } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import type { ChapterHits } from "./bookSearch";

/**
 * Finding a place in a book by its words.
 *
 * A reader who knows the passage but not the chapter has nothing a table of contents can answer, so the book is read
 * once and searched. A hit is a page turn and a scroll: pressing a row turns to that chapter and lands on those words,
 * which is the same thing the outline does for a highlight.
 */
export interface BookSearchPanelProps {
  /** Reading the whole book takes a moment on a large one, and a reader should not think the field is broken. */
  readonly indexing: boolean;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly chapters: readonly ChapterHits[];
  readonly total: number;
  /** `occurrence` is which time that text appears in the chapter, so two hits in one chapter land differently. */
  readonly onGo: (path: string, match: string, occurrence: number) => void;
}

export function BookSearchPanel({
  indexing,
  query,
  onQuery,
  chapters,
  total,
  onGo,
}: BookSearchPanelProps) {
  const searched = query.trim().length > 0;
  const field = useRef<HTMLInputElement | null>(null);
  // Deliberate, not incidental: the panel opens because a reader asked to search, by the button or by ctrl-f, and the
  // caret belongs in the field either way. Focused once on open, never on a later render, so a scroll or a paint cannot
  // pull it back out of the chapter.
  useEffect(() => {
    field.current?.focus();
  }, []);
  return (
    <div className="reader-search" data-testid="reader-search">
      <label className="reader-search-field">
        <IconGlyph icon="lucide:search" size={12} />
        <input
          ref={field}
          type="search"
          className="reader-search-input"
          data-testid="reader-search-input"
          aria-label="Search this book"
          placeholder={indexing ? "Reading the book…" : "Search this book"}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      {!searched ? null : (
        <p className="reader-search-count" data-testid="reader-search-count">
          {chapters.length === 0
            ? "No matches."
            : `${String(total)} ${total === 1 ? "match" : "matches"} in ${String(chapters.length)} ${
                chapters.length === 1 ? "chapter" : "chapters"
              }`}
        </p>
      )}
      {chapters.map((chapter) => (
        <section key={chapter.path} className="reader-search-chapter">
          <h4 className="reader-search-chapter-title">{chapter.title ?? "Untitled chapter"}</h4>
          <ul className="reader-search-rows">
            {chapter.hits.map((hit, index) => (
              <li key={`${chapter.path}-${String(index)}`}>
                <button
                  type="button"
                  className="reader-search-row"
                  data-testid="reader-search-hit"
                  // The words and their occurrence, not an offset: the chapter is found again by its words when the turn
                  // lands, so an index that went stale cannot scroll to the wrong paragraph.
                  onClick={() => onGo(chapter.path, hit.match, index)}
                >
                  <span className="reader-search-before">{hit.before}</span>
                  <mark className="reader-search-match">{hit.match}</mark>
                  <span className="reader-search-after">{hit.after}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
