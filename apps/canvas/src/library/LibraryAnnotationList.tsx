import type { Annotation, AnnotationStyle } from "@suite/graph";
import { partText } from "@suite/graph";
import { useMemo, useState } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { beginHighlightDrag } from "../reader/highlightDrag";

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

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return annotations.filter((annotation) => {
      if (kind === "none" && annotation.cardId !== undefined) return false;
      if (kind !== null && kind !== "none" && annotation.styleId !== kind) return false;
      if (needle.length === 0) return true;
      const words = annotation.excerpt ?? quoteOf(annotation);
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
      <div
        className="reader-mark-filters"
        role="toolbar"
        aria-label="Filter the highlights"
        data-testid="library-annotation-filters"
      >
        <KindChip label="All" active={kind === null} onPick={() => setKind(null)} testId="all" />
        <KindChip
          label="Not a card yet"
          active={kind === "none"}
          onPick={() => setKind("none")}
          testId="none"
        />
        {styles.map((entry) => (
          <KindChip
            key={entry.id}
            label={entry.name}
            colour={entry.color}
            active={kind === entry.id}
            onPick={() => setKind(kind === entry.id ? null : entry.id)}
            testId={entry.id}
          />
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="views-empty" data-testid="library-annotations-filtered-empty">
          <span className="views-empty-title">Nothing matches</span>
          <span>Clear the search or pick another kind.</span>
        </p>
      ) : null}
      {books.map(([bookId, entries]) => (
        <section key={bookId} className="library-annotation-book">
          <h3 className="library-annotation-book-title">{bookTitles.get(bookId) ?? "A book"}</h3>
          <ul className="library-annotation-rows">
            {entries.map((annotation) => {
              const style = styles.find((entry) => entry.id === annotation.styleId);
              const words = annotation.excerpt ?? quoteOf(annotation);
              const card =
                annotation.cardId === undefined ? undefined : cardTitles.get(annotation.cardId);
              const onBoard =
                annotation.cardId === undefined ? false : onBoardCards.has(annotation.cardId);
              const where =
                card === undefined ? (
                  <span className="library-annotation-unplaced">Not a card yet</span>
                ) : onBoard ? (
                  <span className="library-annotation-card">{card}</span>
                ) : (
                  <span className="library-annotation-unplaced">{card}, in the inbox</span>
                );
              return (
                <li key={annotation.id} className="library-annotation-row-wrap">
                  <button
                    type="button"
                    className="library-annotation-row"
                    data-testid={`library-annotation-${annotation.id}`}
                    onPointerDown={(event) => {
                      // The same gesture the reader's own marks use: a threshold, a root attribute that stops the drag
                      // being a text selection, and one release that asks the board where the highlight landed.
                      if (event.button !== 0) return;
                      beginHighlightDrag(
                        annotation.id,
                        { x: event.clientX, y: event.clientY },
                        null,
                      );
                    }}
                    onClick={() => onOpen(annotation)}
                  >
                    <span
                      aria-hidden="true"
                      className="library-annotation-dot"
                      style={{ background: style?.color ?? "var(--accent)" }}
                    />
                    <span className="library-annotation-text">
                      {words.length > 0 ? words : "A passage"}
                      {annotation.parts === undefined || annotation.parts.length === 0 ? null : (
                        <span className="library-annotation-parts">
                          {String(annotation.parts.length)} parts
                        </span>
                      )}
                    </span>
                    <span className="library-annotation-where">{where}</span>
                  </button>
                  <button
                    type="button"
                    className="views-icon-button"
                    aria-label={`Place the highlight “${words.slice(0, 40)}” on the board`}
                    title="Place on the board"
                    data-testid={`library-annotation-place-${annotation.id}`}
                    onClick={() => onPlace(annotation)}
                  >
                    <IconGlyph icon="lucide:import" size={12} />
                  </button>
                  <button
                    type="button"
                    className="views-icon-button"
                    aria-label={`Remove the highlight “${words.slice(0, 40)}”`}
                    data-testid={`library-annotation-remove-${annotation.id}`}
                    onClick={() => onRemove(annotation)}
                  >
                    <IconGlyph icon="lucide:x" size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One filter as a chip, with its kind's colour when it is a kind. The book's panel uses the same shape. */
function KindChip({
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
      className="style-chip"
      data-testid={`library-annotation-filter-${testId}`}
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

function quoteOf(annotation: Annotation): string {
  if (annotation.anchor.kind !== "quote") return "";
  if (annotation.parts === undefined) return annotation.anchor.quote;
  return annotation.parts
    .map((part) => partText(annotation, part))
    .filter((text): text is string => text !== null)
    .join(" · ");
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
