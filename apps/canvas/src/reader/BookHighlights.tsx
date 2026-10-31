import type { Annotation, AnnotationStyle } from "@suite/graph";
import { partText } from "@suite/graph";
import { useState } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { beginHighlightDrag } from "./highlightDrag";

/**
 * The marks a reader has made in this book, in the order they were made.
 *
 * This is where a highlight lives when it has not been placed: the book is the thing it came out of, so the book is
 * where a reader looks for the ones they have not decided about yet. Pressing one raises it, which is where it can be
 * taken apart and placed; a highlight that became a card says so, so "what have I already used" is answerable at a
 * glance rather than by remembering.
 */
export interface BookHighlightsProps {
  annotations: readonly Annotation[];
  styles: readonly AnnotationStyle[];
  onOpen: (annotationId: string) => void;
  /** Put this highlight in the reader's hand, so a press on the board can put it down. */
  onPlace: (annotationId: string) => void;
}

export function BookHighlights({ annotations, styles, onOpen, onPlace }: BookHighlightsProps) {
  /** `null` is everything; `"unplaced"` is the ones with no card; anything else is a kind's id. */
  const [filter, setFilter] = useState<string | null>(null);

  if (annotations.length === 0) {
    return (
      <p className="reader-note" data-testid="book-highlights-empty">
        <IconGlyph icon="lucide:highlighter" size={13} />
        Select a sentence and pick a colour. Your highlights collect here.
      </p>
    );
  }

  const cards = annotations.filter((annotation) => annotation.cardId !== undefined).length;
  const shown = annotations.filter((annotation) => matches(annotation, filter));

  return (
    <div className="reader-marks" data-testid="book-highlights">
      {/* A card may be waiting in the inbox, so the panel counts cards rather than claiming they are on a board: where
          a card sits is the library's answer to give, and it is the one place that can see placements. */}
      <p className="reader-marks-count" data-testid="reader-marks-count">
        {annotations.length} {annotations.length === 1 ? "highlight" : "highlights"} · {cards}{" "}
        {cards === 1 ? "card" : "cards"}
      </p>
      <div
        className="reader-mark-filters"
        role="toolbar"
        aria-label="Filter the highlights"
        data-testid="reader-mark-filters"
      >
        <FilterChip
          label="All"
          active={filter === null}
          onPick={() => setFilter(null)}
          testId="reader-filter-all"
        />
        <FilterChip
          label="Not a card yet"
          active={filter === "unplaced"}
          onPick={() => setFilter("unplaced")}
          testId="reader-filter-unplaced"
        />
        {styles.map((style) => (
          <FilterChip
            key={style.id}
            label={style.name}
            colour={style.color}
            active={filter === style.id}
            onPick={() => setFilter(style.id)}
            testId={`reader-filter-${style.id}`}
          />
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="reader-note" data-testid="reader-marks-filtered-empty">
          Nothing of this kind yet.
        </p>
      ) : null}
      <ul className="reader-marks-rows">
        {shown.map((annotation) => {
          const style = styles.find((entry) => entry.id === annotation.styleId);
          return (
            <li key={annotation.id}>
              <button
                type="button"
                className="reader-mark"
                data-testid={`book-highlight-${annotation.id}`}
                onPointerDown={(event) => {
                  // Travel makes it a drag, exactly as a painted mark and a library row behave: one gesture means one
                  // thing wherever a highlight is shown.
                  if (event.button !== 0) return;
                  beginHighlightDrag(annotation.id, { x: event.clientX, y: event.clientY }, null);
                }}
                onClick={() => onOpen(annotation.id)}
              >
                <span
                  aria-hidden="true"
                  className="reader-mark-dot"
                  style={{ background: style?.color ?? "var(--accent)" }}
                />
                <span className="reader-mark-text">{wordsOf(annotation)}</span>
                {annotation.cardId === undefined ? null : (
                  <span className="reader-mark-placed" title="This highlight is a card">
                    <IconGlyph icon="lucide:check" size={11} />
                  </span>
                )}
              </button>
              <button
                type="button"
                className="views-icon-button"
                aria-label="Place this highlight on the board"
                title="Place on the board"
                data-testid={`book-highlight-place-${annotation.id}`}
                onClick={() => onPlace(annotation.id)}
              >
                <IconGlyph icon="lucide:import" size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Whether a highlight belongs in the current filter. */
function matches(annotation: Annotation, filter: string | null): boolean {
  if (filter === null) return true;
  if (filter === "unplaced") return annotation.cardId === undefined;
  return annotation.styleId === filter;
}

/** One filter as a chip, with its kind's colour when it is a kind. */
function FilterChip({
  label,
  colour,
  active,
  onPick,
  testId,
}: {
  label: string;
  colour?: string | undefined;
  active: boolean;
  onPick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      className="style-chip reader-mark-filter"
      data-testid={testId}
      data-checked={active ? "true" : undefined}
      aria-pressed={active}
      onClick={onPick}
    >
      {colour === undefined ? null : (
        <span
          aria-hidden="true"
          className="reader-mark-dot"
          style={{ background: colour, marginRight: 4 }}
        />
      )}
      {label}
    </button>
  );
}

/** What a highlight says: its excerpt, or the parts it was broken into when those are all it has. */
function wordsOf(annotation: Annotation): string {
  if (annotation.excerpt !== undefined && annotation.excerpt.length > 0) return annotation.excerpt;
  if (annotation.anchor.kind !== "quote") return "A passage";
  const parts = annotation.parts ?? [];
  if (parts.length === 0) return annotation.anchor.quote;
  return parts
    .map((part) => partText(annotation, part))
    .filter((text): text is string => text !== null)
    .join(" · ");
}
