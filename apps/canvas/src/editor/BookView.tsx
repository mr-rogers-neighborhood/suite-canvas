import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { BookReader } from "../reader/BookReader";

/**
 * A book on a card.
 *
 * The block is a `media` node with `kind: "epub"`, so it takes the path every other attachment takes: the bytes
 * live beside the document, this browser's copy is read first, and the relay is the fallback. What is different
 * is the body: an image is an `<img>` and a book is a surface, so the reader takes the whole width it is given
 * and offers the card a way to open it large.
 */
export function BookView({
  node,
  selected,
  sourceCardId,
}: NodeViewProps & { sourceCardId: string }) {
  const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
  const mime = typeof node.attrs.mime === "string" ? node.attrs.mime : "application/epub+zip";
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "Untitled book";

  return (
    <NodeViewWrapper
      as="div"
      className="book-node"
      data-testid="book-node"
      contentEditable={false}
      data-selected={selected ? "true" : undefined}
    >
      <BookReader
        attachmentId={id}
        mime={mime}
        name={name}
        {...(sourceCardId.length === 0 ? {} : { sourceCardId })}
      />
    </NodeViewWrapper>
  );
}
