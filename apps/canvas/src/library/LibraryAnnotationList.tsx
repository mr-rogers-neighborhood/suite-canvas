import type { Annotation, AnnotationStyle } from "@suite/graph";
import { useMemo, useState } from "react";
import { AnnotationKindChips, matchesKind } from "../annotations/AnnotationKindChips";
import { AnnotationRow, wordsOf } from "../annotations/AnnotationRow";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * The highlights a workspace has made, grouped by the book they came from.
 *
 * The Annotations tab lists **highlights**, not only the cards they became: "track my annotations" is the question a
 * reader asks, and a highlight is the thing they made. Each row says what it is — the words, the kind, where it went —
 * and each can be carried to the board or placed with a button, which are the same act for a mouse and a keyboard.
 *
 * A row is not a `LibraryItem`: an item is a card or a board, and a highlight is neither. The list is its own
 * component for the same reason `LibraryMediaList` is, and for the same reason it is honest about it.
 *
 * **The row controls live here, not in the drawer.** The drawer's search box and facets are built for cards, and a
 * highlight has neither a type nor a section, so the tab carries its own: a query over the words and the book's name,
 * and the kinds as chips, which is the same filter the book's own panel offers. Keeping them in this component is what
 * lets the drawer stay a frame.
 */
export interface LibraryAnnotationListProps {
  annotations: readonly Annotation[];
  styles: readonly AnnotationStyle[];
  /** Card id → the title of the card a highlight became, for the rows that have one. */
  cardTitles: ReadonlyMap<string, string>;
  /** The cards that are on the board being looked at, so a row can say where its card actually is. */
  onBoardCards: ReadonlySet<string>;
  /** Book card id → its title, for the group headings. */
  bookTitles: ReadonlyMap<string, string>;
  onOpen: (annotation: Annotation) => void;
  /** Put this highlight in the reader's hand, which is what a drag out of the drawer does. */
  onPlace: (annotation: Annotation) => void;
  onRemove: (annotation: Annotation) => void;
  /** Open the editor for the kinds of highlight there are, and what each one becomes. */
  onEditKinds?: (() => void) | undefined;
}

export function LibraryAnnotationList({
  annotations,
  styles,
  cardTitles,
  onBoardCards,
  bookTitles,
  onOpen,
  onPlace,
  onRemove,
  onEditKinds,
}: LibraryAnnotationListProps) {
  /** `null` is every kind; `"none"` is the ones with no card yet; anything else is a kind's id. */
  const [kind, setKind] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Rows showing their whole passage, which the book's panel has always offered and this one did not. */
  const [expanded, setExpanded] = useState<readonly string[]>([]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return annotations.filter((annotation) => {
      // The chips are the shared ones, so the predicate is too: a chip cannot mean one thing here and another in a book.
      if (!matchesKind(annotation, kind === "none" ? "unplaced" : kind)) return false;
      if (needle.length === 0) return true;
      const words = wordsOf(annotation);
      const book = bookTitles.get(annotation.sourceCardId) ?? "";
      return `${words} ${book}`.toLowerCase().includes(needle);
    });
  }, [annotations, kind, query, bookTitles]);

  const kindsButton = (
    <div className="library-annotations-head">
      <input
        className="views-input library-annotations-search"
        type="search"
        aria-label="Search your highlights"
        placeholder="Search highlights"
        data-testid="library-annotation-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {onEditKinds === undefined ? null : (
        <button
          type="button"
          className="views-button views-button--quiet"
          data-testid="library-annotation-kinds"
          onClick={onEditKinds}
        >
          <IconGlyph icon="lucide:sliders-horizontal" size={12} />
          Kinds
        </button>
      )}
    </div>
  );

  if (annotations.length === 0) {
    return (
      <p className="views-empty" data-testid="library-annotations-empty">
        <span className="views-empty-title">No highlights yet</span>
        <span>
          Read a book on the board and mark a sentence. Every highlight you make is tracked here.
        </span>
      </p>
    );
  }

  const books = [...groupBy(shown, (annotation) => annotation.sourceCardId).entries()];

  return (
    <div className="library-annotations" data-testid="library-annotations">
      {kindsButton}
      <AnnotationKindChips
        styles={styles}
        kind={kind}
        onKind={setKind}
        testId="library-annotation-filter"
      />
      {shown.length === 0 ? (
        <p className="views-empty" data-testid="library-annotations-filtered-empty">
          <span className="views-empty-title">Nothing matches</span>
          <span>Clear the search or pick another kind.</span>
        </p>
      ) : null}
      {books.map(([bookId, entries]) => (
        <section key={bookId} className="library-annotation-book">
          <h3 className="library-annotation-book-title">{bookTitles.get(bookId) ?? "A book"}</h3>
          <ul className="annotation-rows">
            {entries.map((annotation) => {
              const card =
                annotation.cardId === undefined ? undefined : cardTitles.get(annotation.cardId);
              const onBoard =
                annotation.cardId === undefined ? false : onBoardCards.has(annotation.cardId);
              const where =
                card === undefined ? (
                  <span className="annotation-row-unplaced">Not a card yet</span>
                ) : onBoard ? (
                  <span className="annotation-row-card">{card}</span>
                ) : (
                  <span className="annotation-row-unplaced">{card}, in the inbox</span>
                );
              return (
                <AnnotationRow
                  key={annotation.id}
                  annotation={annotation}
                  colour={styles.find((entry) => entry.id === annotation.styleId)?.color}
                  testId="library-annotation"
                  expanded={expanded.includes(annotation.id)}
                  onToggleExpand={() =>
                    setExpanded((current) =>
                      current.includes(annotation.id)
                        ? current.filter((id) => id !== annotation.id)
                        : [...current, annotation.id],
                    )
                  }
                  onOpen={() => onOpen(annotation)}
                  onPlace={() => onPlace(annotation)}
                  onRemove={() => onRemove(annotation)}
                  where={where}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const group = key(item);
    const bucket = out.get(group);
    if (bucket === undefined) out.set(group, [item]);
    else bucket.push(item);
  }
  return out;
}
