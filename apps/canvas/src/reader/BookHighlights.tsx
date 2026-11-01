import type { Annotation, AnnotationStyle } from "@suite/graph";
import { partText } from "@suite/graph";
import { useState } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { slotLabel } from "./HighlightFocus";
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
  /** Put several in one hand, in the order the reader ticked them. */
  onPlaceMany?: ((annotationIds: readonly string[]) => void) | undefined;
  /** Take the whole list somewhere else, as Markdown. */
  onCopyMarkdown?: (() => void) | undefined;
}

export function BookHighlights({
  annotations,
  styles,
  onOpen,
  onPlace,
  onPlaceMany,
  onCopyMarkdown,
}: BookHighlightsProps) {
  /** `null` is everything; `"unplaced"` is the ones with no card; anything else is a kind's id. */
  const [filter, setFilter] = useState<string | null>(null);
  /**
   * The rows the reader has ticked, in the order they ticked them.
   *
   * Order is the whole point: a stack goes down in the order it was built, so the same list of highlights arranged two
   * ways is two different boards. Ticking appends, and the sequence editor can reorder afterwards.
   */
  const [selected, setSelected] = useState<readonly string[]>([]);
  /** Rows expanded to their whole passage, which a two-line row cannot show. */
  const [expanded, setExpanded] = useState<readonly string[]>([]);

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
      <div className="reader-marks-head">
        <p className="reader-marks-count" data-testid="reader-marks-count">
          {annotations.length} {annotations.length === 1 ? "highlight" : "highlights"} · {cards}{" "}
          {cards === 1 ? "card" : "cards"}
        </p>
        {onCopyMarkdown === undefined ? null : (
          <button
            type="button"
            className="views-icon-button"
            aria-label="Copy these highlights as Markdown"
            title="Copy these highlights as Markdown"
            data-testid="reader-marks-copy"
            onClick={onCopyMarkdown}
          >
            <IconGlyph icon="lucide:clipboard-copy" size={12} />
          </button>
        )}
      </div>
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
      {selected.length === 0 || onPlaceMany === undefined ? null : (
        <div className="reader-marks-bar" data-testid="reader-marks-selection">
          <span className="reader-marks-bar-count">
            {selected.length} {selected.length === 1 ? "highlight" : "highlights"} picked
          </span>
          <button
            type="button"
            className="views-button views-button--quiet"
            data-testid="reader-marks-clear"
            onClick={() => setSelected([])}
          >
            Clear
          </button>
          <button
            type="button"
            className="views-button views-button--primary"
            data-testid="reader-marks-place-selection"
            onClick={() => {
              // In the order they were ticked: a stack goes down in the order it was built, and that is the reader's only
              // chance to say which of these belongs nearest the idea they are placing from.
              onPlaceMany(selected);
              setSelected([]);
            }}
          >
            Place {selected.length}
          </button>
        </div>
      )}
      <ul className="reader-marks-rows">
        {shown.map((annotation) => {
          const style = styles.find((entry) => entry.id === annotation.styleId);
          const picked = selected.includes(annotation.id);
          const open = expanded.includes(annotation.id);
          return (
            <li
              key={annotation.id}
              className="reader-mark-row"
              data-picked={picked ? "true" : undefined}
            >
              {onPlaceMany === undefined ? null : (
                <input
                  type="checkbox"
                  className="reader-mark-pick"
                  aria-label={`Pick “${wordsOf(annotation).slice(0, 40)}” to place`}
                  data-testid={`book-highlight-pick-${annotation.id}`}
                  checked={picked}
                  onChange={() =>
                    // Ticking appends, so the order the reader ticks in is the order the stack is in.
                    setSelected((current) =>
                      current.includes(annotation.id)
                        ? current.filter((id) => id !== annotation.id)
                        : [...current, annotation.id],
                    )
                  }
                />
              )}
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
                <span className="reader-mark-text" data-expanded={open ? "true" : undefined}>
                  {wordsOf(annotation)}
                </span>
                {annotation.note === undefined ? null : (
                  <span className="reader-mark-note" title="This highlight has a note">
                    <IconGlyph icon="lucide:message-square" size={10} />
                  </span>
                )}
                {annotation.cardId === undefined ? null : (
                  <span className="reader-mark-placed" title="This highlight is a card">
                    <IconGlyph icon="lucide:check" size={11} />
                  </span>
                )}
              </button>
              {open ? (
                <div
                  className="reader-mark-full"
                  data-testid={`book-highlight-full-${annotation.id}`}
                >
                  <span className="reader-mark-full-words">{passageOf(annotation)}</span>
                  {annotation.parts === undefined || annotation.parts.length === 0 ? null : (
                    <ol className="reader-mark-full-parts">
                      {annotation.parts.map((part) => (
                        <li key={part.id}>
                          <span className="reader-mark-full-target">{slotLabel(part.target)}</span>
                          <span>{partText(annotation, part) ?? ""}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {annotation.note === undefined ? null : (
                    <p
                      className="reader-mark-full-note"
                      data-testid={`book-highlight-note-${annotation.id}`}
                    >
                      {annotation.note}
                    </p>
                  )}
                </div>
              ) : null}
              <button
                type="button"
                className="views-icon-button"
                aria-label={open ? "Collapse this highlight" : "Show the whole passage"}
                aria-expanded={open}
                title={open ? "Collapse" : "Show the whole passage"}
                data-testid={`book-highlight-expand-${annotation.id}`}
                onClick={() =>
                  setExpanded((current) =>
                    current.includes(annotation.id)
                      ? current.filter((id) => id !== annotation.id)
                      : [...current, annotation.id],
                  )
                }
              >
                <IconGlyph icon={open ? "lucide:chevron-up" : "lucide:chevron-down"} size={12} />
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

/** The passage in full, which a row's first line is not. */
function passageOf(annotation: Annotation): string {
  if (annotation.anchor.kind !== "quote") return wordsOf(annotation);
  return annotation.anchor.quote;
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
