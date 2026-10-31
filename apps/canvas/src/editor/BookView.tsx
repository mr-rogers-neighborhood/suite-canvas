import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { IconGlyph } from "../icons/IconGlyph";
import { useBookBytes } from "../reader/useBookBytes";
import { useBookCover } from "../reader/useBookCover";
import { useUiStore } from "../store/useUiStore";

/**
 * A book on a card.
 *
 * The block is a `media` node with `kind: "epub"`, so it takes the path every attachment takes: the bytes live
 * beside the document, this browser's copy is read first, and the relay is the fallback. What it draws is a
 * **cover**, not a reader.
 *
 * That is deliberate. A reader needs a selection, and a selection inside a `contentEditable` region belongs to
 * ProseMirror: the highlight gesture would be a fight with the editor rather than a gesture. A live reader here
 * would also restart on chapter one whenever its node was replaced. So the block says what the book is and offers
 * **Read**, and the reading happens in focus mode, where the surface is ours and the card chrome stays live.
 */
export function BookView({ node, selected, editor }: NodeViewProps) {
  const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "Untitled book";
  const bytes = useBookBytes(id);
  const cover = useBookCover(bytes);
  // Focus mode, not the camera: `focusCard` pans the board to a card and `openCardFocus` opens the surface the
  // reader is for. Read is a press on this card, so it wants the second.
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  // The card that owns this body is the one the editor was configured with — the same fact the `@` picker
  // reads — rather than the board's selection, which says what the reader last pressed and not whose body this is.
  const cardId = (editor.storage as { mention?: { cardId?: string } }).mention?.cardId ?? null;

  return (
    <NodeViewWrapper
      as="div"
      className="book-node"
      data-testid="book-node"
      contentEditable={false}
      data-selected={selected ? "true" : undefined}
    >
      <div className="book-cover">
        <div className="book-cover-art">
          {cover.status === "ready" && cover.cover.coverUrl !== null ? (
            // The cover comes from the book's own bytes, so `no-referrer` and an empty alt are the whole policy:
            // nothing here is fetched from anywhere.
            <img src={cover.cover.coverUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <IconGlyph icon="lucide:book" size={30} />
          )}
        </div>
        <div className="book-cover-text">
          <span className="book-cover-title" data-testid="book-cover-title">
            {cover.status === "ready" ? cover.cover.title : name}
          </span>
          {cover.status === "ready" ? (
            <span className="book-cover-meta">
              {cover.cover.creator ?? "Unknown author"} · {cover.cover.chapters}{" "}
              {cover.cover.chapters === 1 ? "chapter" : "chapters"}
            </span>
          ) : null}
          {cover.status === "refused" ? (
            <span className="book-cover-refused" data-testid="book-cover-refused">
              {cover.reason}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="views-button views-button--primary book-cover-read"
          data-testid="book-read"
          disabled={cover.status !== "ready"}
          onClick={() => {
            if (cardId !== null) openCardFocus(cardId);
          }}
        >
          Read
        </button>
      </div>
    </NodeViewWrapper>
  );
}
