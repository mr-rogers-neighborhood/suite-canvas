import { IconGlyph } from "../icons/IconGlyph";
import { useContinueReading } from "../reader/useContinueReading";

/**
 * The books this reader is partway through.
 *
 * A library is a place things are filed; a book is a place someone was. So the books with a reading position get a strip
 * above the rows, with the bar that says how far in they are, because "continue reading" is a question the list cannot
 * answer: it knows titles, not pages.
 */
export interface ContinueReadingProps {
  readonly onOpenCard: (cardId: string) => void;
}

export function ContinueReading({ onOpenCard }: ContinueReadingProps) {
  const books = useContinueReading();
  if (books.length === 0) return null;
  return (
    <div className="library-continue" data-testid="library-continue">
      <h3 className="library-continue-title">Continue reading</h3>
      {books.map((book) => (
        <button
          key={book.cardId}
          type="button"
          className="library-continue-row"
          data-testid="library-continue-row"
          // The percentage belongs in the name rather than in a nested progressbar role: a bar inside a button is a
          // control inside a control, and the number is one word a reader wants anyway.
          aria-label={`${book.name}, ${String(Math.round(book.position.progress * 100))}% read`}
          onClick={() => onOpenCard(book.cardId)}
        >
          <IconGlyph icon="lucide:book-open" size={12} />
          <span className="library-continue-name">{book.name}</span>
          <span className="library-continue-bar" aria-hidden="true">
            <span
              className="library-continue-fill"
              style={{ width: `${String(Math.round(book.position.progress * 100))}%` }}
            />
          </span>
        </button>
      ))}
    </div>
  );
}
