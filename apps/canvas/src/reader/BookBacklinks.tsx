import type { Annotation } from "@suite/graph";
import { IconGlyph } from "../icons/IconGlyph";
import { useCanvasStore } from "../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { type BookBacklink, producedCards, referencingCards } from "./bookBacklinks";

/**
 * What a book has produced, and what else points at it.
 *
 * The card a highlight became is the thing a reader wants to find again from inside the book, and nothing on the chapter
 * carries it: the mark says "placed", not where. So the book lists its cards by title, and a press peeks at the card.
 */
export interface BookBacklinksProps {
  readonly bookCardId: string;
  readonly annotations: readonly Annotation[];
  readonly onOpen: (cardId: string) => void;
}

function reasonLabel(reason: BookBacklink["reason"]): string {
  if (reason.kind === "mentions") return "mentions this book";
  if (reason.kind === "property") return reason.fieldName;
  return "from this book";
}

/** The book's two lists, read from the document. Kept here so the view is a component a test can hand data to. */
export function useBookBacklinks(bookCardId: string, annotations: readonly Annotation[]) {
  const snapshot = useWorkspaceSnapshot();
  const workspace = useCanvasStore((state) => state.workspace);
  return {
    produced: producedCards(annotations),
    referencing: referencingCards({
      bookCardId,
      annotations,
      cards: snapshot.cards,
      types: snapshot.types,
      references: snapshot.references,
    }),
    // A card's text lives in the document, not in the snapshot, so a title is a read rather than a field.
    titleOf: (cardId: string): string => workspace?.displayTitle(cardId) ?? "Untitled",
  };
}

export function BookBacklinks({ bookCardId, annotations, onOpen }: BookBacklinksProps) {
  const links = useBookBacklinks(bookCardId, annotations);
  return <BookBacklinksView {...links} onOpen={onOpen} />;
}

export interface BookBacklinksViewProps {
  readonly produced: readonly string[];
  readonly referencing: readonly BookBacklink[];
  readonly titleOf: (cardId: string) => string;
  readonly onOpen: (cardId: string) => void;
}

export function BookBacklinksView({
  produced,
  referencing,
  titleOf,
  onOpen,
}: BookBacklinksViewProps) {
  const row = (cardId: string, label: string, key: string) => (
    <li key={key}>
      <button
        type="button"
        className="reader-backlink"
        data-testid="book-backlink"
        // Trashed is not gone: the card is restorable, and a row that vanished with it would leave a reader wondering
        // where the passage went.
        onClick={() => onOpen(cardId)}
      >
        <IconGlyph icon="lucide:sticky-note" size={11} />
        <span className="reader-backlink-title">{titleOf(cardId)}</span>
        <span className="reader-backlink-reason">{label}</span>
      </button>
    </li>
  );

  if (produced.length === 0 && referencing.length === 0) {
    return (
      <p className="reader-marks-count" data-testid="book-backlinks-empty">
        Nothing is linked to this book yet. A highlight you place becomes a card that points back
        here.
      </p>
    );
  }

  return (
    <div className="reader-backlinks" data-testid="book-backlinks">
      {produced.length === 0 ? null : (
        <section className="reader-backlink-group">
          <h4 className="reader-search-chapter-title">
            {`${String(produced.length)} ${produced.length === 1 ? "card" : "cards"} from this book`}
          </h4>
          <ul className="reader-search-rows">
            {produced.map((cardId) => row(cardId, reasonLabel({ kind: "produced" }), cardId))}
          </ul>
        </section>
      )}
      {referencing.length === 0 ? null : (
        <section className="reader-backlink-group">
          <h4 className="reader-search-chapter-title">Linked here</h4>
          <ul className="reader-search-rows">
            {referencing.map((link) =>
              row(link.cardId, reasonLabel(link.reason), `${link.cardId}-${link.reason.kind}`),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
