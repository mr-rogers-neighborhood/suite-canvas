import type { Annotation, AnnotationStyle } from "@suite/graph";
import { partText } from "@suite/graph";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * The highlights a workspace has made, grouped by the book they came from.
 *
 * The Annotations tab lists **highlights**, not only the cards they became: "track my annotations" is the question a
 * reader asks, and a highlight is the thing they made. Each row says what it is — the words, the colour, whether it
 * has left the book — and each is pressable and draggable, which is how one becomes a card.
 *
 * A row is not a `LibraryItem`: an item is a card or a board, and a highlight is neither. The list is its own
 * component for the same reason `LibraryMediaList` is, and for the same reason it is honest about it.
 */
export interface LibraryAnnotationListProps {
  annotations: readonly Annotation[];
  styles: readonly AnnotationStyle[];
  /** Card id → the title of the card a highlight became, for the rows that have one. */
  cardTitles: ReadonlyMap<string, string>;
  /** Book card id → its title, for the group headings. */
  bookTitles: ReadonlyMap<string, string>;
  onOpen: (annotation: Annotation) => void;
  /** A press that travels carries the highlight to the board, which is how it becomes a card. */
  onCarry: (annotation: Annotation, point: { x: number; y: number }) => void;
  onRemove: (annotation: Annotation) => void;
  /** Open the editor for the kinds of highlight there are, and what each one becomes. */
  onEditTypes?: (() => void) | undefined;
}

export function LibraryAnnotationList({
  annotations,
  styles,
  cardTitles,
  bookTitles,
  onOpen,
  onCarry,
  onRemove,
  onEditTypes,
}: LibraryAnnotationListProps) {
  const typesButton =
    onEditTypes === undefined ? null : (
      <div className="library-annotations-head">
        <button
          type="button"
          className="views-button views-button--quiet"
          data-testid="library-annotation-types"
          onClick={onEditTypes}
        >
          <IconGlyph icon="lucide:sliders-horizontal" size={12} />
          Types
        </button>
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

  const books = [...groupBy(annotations, (annotation) => annotation.sourceCardId).entries()];

  return (
    <div className="library-annotations" data-testid="library-annotations">
      {typesButton}
      {books.map(([bookId, entries]) => (
        <section key={bookId} className="library-annotation-book">
          <h3 className="library-annotation-book-title">{bookTitles.get(bookId) ?? "A book"}</h3>
          <ul className="library-annotation-rows">
            {entries.map((annotation) => {
              const style = styles.find((entry) => entry.id === annotation.styleId);
              const words = annotation.excerpt ?? quoteOf(annotation);
              const card =
                annotation.cardId === undefined ? undefined : cardTitles.get(annotation.cardId);
              return (
                <li key={annotation.id} className="library-annotation-row-wrap">
                  <button
                    type="button"
                    className="library-annotation-row"
                    data-testid={`library-annotation-${annotation.id}`}
                    onPointerDown={(event) => {
                      // A press that travels is a drag, and a drag is a promotion: the same rule the library's card
                      // rows follow, so one gesture means one thing across the drawer.
                      const start = { x: event.clientX, y: event.clientY };
                      const move = (moving: PointerEvent) => {
                        if (Math.hypot(moving.clientX - start.x, moving.clientY - start.y) < 4)
                          return;
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                        onCarry(annotation, { x: moving.clientX, y: moving.clientY });
                      };
                      const up = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", up);
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
                    <span className="library-annotation-where">
                      {card === undefined ? (
                        <span className="library-annotation-unplaced">Not on the board</span>
                      ) : (
                        <span className="library-annotation-card">{card}</span>
                      )}
                    </span>
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
