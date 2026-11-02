import type { RefObject } from "react";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * The reader's header: the book, where the reader is in it, and the doors out of the chapter.
 *
 * Its own component because it is the one part of the reader with no behaviour of its own beyond reporting presses: the
 * panels, the chapter turns and the bookshelf live in the host, and a header that grew them all was a host that could no
 * longer be read in one screen.
 */
export interface ReaderHeadProps {
  readonly title: string;
  readonly creator: string | null;
  /** 1-based, for the sentence a reader reads: "Chapter 3 of 12". */
  readonly chapterNumber: number;
  readonly chapterCount: number;
  readonly panel: ReaderPanel | "none";
  readonly onPanel: (panel: ReaderPanel) => void;
  readonly areaMode: boolean;
  readonly onAreaMode: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onExpand: (() => void) | undefined;
  /** Written from the scroll rather than from state, so reading does not re-render the chapter. */
  readonly progressRef: RefObject<HTMLSpanElement | null>;
}

export type ReaderPanel = "search" | "contents" | "highlights" | "cards";

/** The book's side panels, in the order the header offers them: the words first, then what came out of them. */
export const READER_PANELS: readonly {
  readonly panel: ReaderPanel;
  readonly label: string;
  readonly icon: string;
  readonly testId: string;
}[] = [
  {
    panel: "search",
    label: "Search this book",
    icon: "lucide:search",
    testId: "reader-search-toggle",
  },
  { panel: "contents", label: "Contents", icon: "lucide:list", testId: "reader-contents-toggle" },
  {
    panel: "highlights",
    label: "Your highlights",
    icon: "lucide:highlighter",
    testId: "reader-highlights-toggle",
  },
  {
    panel: "cards",
    label: "Cards from this book",
    icon: "lucide:square-stack",
    testId: "reader-cards-toggle",
  },
];

export function ReaderHead({
  title,
  creator,
  chapterNumber,
  chapterCount,
  panel,
  onPanel,
  areaMode,
  onAreaMode,
  onPrevious,
  onNext,
  canGoBack,
  canGoForward,
  onExpand,
  progressRef,
}: ReaderHeadProps) {
  return (
    <header className="reader-head">
      {READER_PANELS.map((entry) => (
        <button
          key={entry.panel}
          type="button"
          className="views-icon-button"
          aria-label={entry.label}
          title={entry.label}
          aria-expanded={panel === entry.panel}
          data-testid={entry.testId}
          onClick={() => onPanel(entry.panel)}
        >
          <IconGlyph icon={entry.icon} size={14} />
        </button>
      ))}
      <button
        type="button"
        className="views-icon-button"
        aria-label="Mark an area"
        title="Mark an area"
        aria-pressed={areaMode}
        data-testid="reader-area-toggle"
        onClick={onAreaMode}
      >
        <IconGlyph icon="lucide:square-dashed" size={14} />
      </button>
      <span className="reader-title" title={title}>
        {title}
      </span>
      {creator === null ? null : <span className="reader-meta">{creator}</span>}
      <span className="reader-meta" data-testid="reader-where">
        {`Chapter ${String(chapterNumber)} of ${String(chapterCount)}`}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="views-icon-button"
          aria-label="Previous chapter"
          data-testid="reader-prev"
          disabled={!canGoBack}
          onClick={onPrevious}
        >
          <IconGlyph icon="lucide:chevron-left" size={14} />
        </button>
        <button
          type="button"
          className="views-icon-button"
          aria-label="Next chapter"
          data-testid="reader-next"
          disabled={!canGoForward}
          onClick={onNext}
        >
          <IconGlyph icon="lucide:chevron-right" size={14} />
        </button>
        {onExpand === undefined ? null : (
          <button
            type="button"
            className="views-icon-button"
            aria-label="Read this book large"
            title="Read large"
            data-testid="reader-expand"
            onClick={onExpand}
          >
            <IconGlyph icon="lucide:maximize-2" size={14} />
          </button>
        )}
      </span>
      <span className="reader-progress" aria-hidden="true">
        <span className="reader-progress-bar" ref={progressRef} data-testid="reader-progress" />
      </span>
    </header>
  );
}
