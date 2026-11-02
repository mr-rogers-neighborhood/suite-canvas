import type { Annotation, AnnotationStyle } from "@suite/graph";
import { useState } from "react";
import { AnnotationKindChips, matchesKind } from "../annotations/AnnotationKindChips";
import { AnnotationRow, wordsOf } from "../annotations/AnnotationRow";
import { ActionBar } from "../chrome/ActionBar";
import { IconGlyph } from "../icons/IconGlyph";

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
  /** Take the highlight out of the book. The library's list has always had this; a row should not lose a verb by moving. */
  onRemove?: ((annotationId: string) => void) | undefined;
}

export function BookHighlights({
  annotations,
  styles,
  onOpen,
  onPlace,
  onPlaceMany,
  onCopyMarkdown,
  onRemove,
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
  const shown = annotations.filter((annotation) => matchesKind(annotation, filter));

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
      <AnnotationKindChips
        styles={styles}
        kind={filter}
        onKind={setFilter}
        testId="reader-filter"
      />
      {shown.length === 0 ? (
        <p className="reader-note" data-testid="reader-marks-filtered-empty">
          Nothing of this kind yet.
        </p>
      ) : null}
      {selected.length === 0 || onPlaceMany === undefined ? null : (
        <ActionBar
          testId="reader-marks-selection"
          note={`${String(selected.length)} ${selected.length === 1 ? "highlight" : "highlights"} picked`}
          actions={[
            { label: "Clear", testId: "reader-marks-clear", onSelect: () => setSelected([]) },
            {
              label: `Place ${String(selected.length)}`,
              testId: "reader-marks-place-selection",
              primary: true,
              onSelect: () => {
                // In the order they were ticked: a stack goes down in the order it was built, and that is the reader's
                // only chance to say which of these belongs nearest the idea they are placing from.
                onPlaceMany(selected);
                setSelected([]);
              },
            },
          ]}
        />
      )}
      <ul className="reader-marks-rows">
        {shown.map((annotation) => {
          const picked = selected.includes(annotation.id);
          return (
            <AnnotationRow
              key={annotation.id}
              annotation={annotation}
              colour={styles.find((entry) => entry.id === annotation.styleId)?.color}
              testId="book-highlight"
              expanded={expanded.includes(annotation.id)}
              onToggleExpand={() =>
                setExpanded((current) =>
                  current.includes(annotation.id)
                    ? current.filter((id) => id !== annotation.id)
                    : [...current, annotation.id],
                )
              }
              onOpen={() => onOpen(annotation.id)}
              onPlace={() => onPlace(annotation.id)}
              {...(onRemove === undefined ? {} : { onRemove: () => onRemove(annotation.id) })}
              {...(onPlaceMany === undefined
                ? {}
                : {
                    pick: {
                      checked: picked,
                      // Ticking appends, so the order the reader ticks in is the order the stack is in.
                      onToggle: () =>
                        setSelected((current) =>
                          current.includes(annotation.id)
                            ? current.filter((id) => id !== annotation.id)
                            : [...current, annotation.id],
                        ),
                      label: `Pick “${wordsOf(annotation).slice(0, 40)}” to place`,
                    },
                  })}
            />
          );
        })}
      </ul>
    </div>
  );
}
