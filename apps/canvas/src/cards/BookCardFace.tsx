import type { Card } from "@suite/graph";
import { useEffect, useState } from "react";
import { MEDIA_NODE_NAME } from "../editor/mediaNode";
import { bookDetails, extractCover, useBookCoverCache } from "../reader/bookCoverCache";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * A book on the canvas.
 *
 * The card *is* the book: the cover fills it the way a picture fills an image card, and the details a reader wants
 * before deciding to read sit under it — the title, the author, how many chapters, and **Read**.
 *
 * The cover is deliberately not drawn by reading the archive here. `extractCover` does that once, off the paint, and
 * publishes it; this face reads what is ready. A board of forty cards is forty faces before anybody clicks, so the
 * expensive part is deferred and the first paint shows the book's name instead of waiting for a zip.
 */
export function BookCardFace({ card }: { card: Card }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const file = workspace === null ? null : bookBlockOf(workspace, card.id);
  const attachmentId = file?.id ?? "";

  // Subscribing to the cache rather than reading it once: the extractor publishes after this face has painted.
  const cover = useBookCoverCache((state) => state.covers[attachmentId] ?? null);
  const [details, setDetails] = useState<{
    title: string;
    creator: string | null;
    chapters: number;
  } | null>(null);

  useEffect(() => {
    if (attachmentId.length === 0) return;
    void extractCover(attachmentId);
  }, [attachmentId]);

  useEffect(() => {
    if (attachmentId.length === 0) return;
    let cancelled = false;
    void bookDetails(attachmentId).then((found) => {
      if (!cancelled) setDetails(found);
    });
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  const title = details?.title ?? file?.name ?? "Untitled book";
  // No word for "still reading the zip": the empty tile already says the cover has not arrived, and a card that
  // narrates its own loading is a card that flickers. The author is the fact worth the line.
  const author = details?.creator ?? "Book";

  return (
    <div className="book-card" data-testid="book-card-face">
      <div className="book-card-art" data-has-cover={cover === null ? undefined : "true"}>
        {cover === null ? (
          <span aria-hidden="true" className="book-card-placeholder">
            {"\u{1f4d6}"}
          </span>
        ) : (
          // The cover is bytes from the book's own archive, held as an object URL, so nothing is fetched from
          // anywhere and `no-referrer` is the whole of the policy.
          <img
            className="book-card-cover"
            src={cover}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
          />
        )}
      </div>
      <div className="book-card-text">
        <span className="book-card-title" data-testid="book-card-title">
          {title}
        </span>
        <span className="book-card-meta" data-testid="book-card-meta">
          {author}
          {details === null
            ? ""
            : ` · ${String(details.chapters)} ${details.chapters === 1 ? "chapter" : "chapters"}`}
        </span>
      </div>
      <button
        type="button"
        // A node is a drag surface: without this the press would start a drag of the card instead of opening the book.
        className="book-card-read nodrag nopan"
        data-testid="book-card-read"
        onClick={(event) => {
          event.stopPropagation();
          openCardFocus(card.id);
        }}
      >
        Read
      </button>
    </div>
  );
}

/** The `media` block of kind `epub` a card holds, or null. */
function bookBlockOf(
  workspace: NonNullable<ReturnType<typeof useCanvasStore.getState>["workspace"]>,
  cardId: string,
): { id: string; name: string } | null {
  for (const node of workspace.bodyNodes(cardId)) {
    if (node.type !== MEDIA_NODE_NAME || node.attrs?.kind !== "epub") continue;
    return {
      id: typeof node.attrs.id === "string" ? node.attrs.id : "",
      name: typeof node.attrs.name === "string" ? node.attrs.name : "Untitled book",
    };
  }
  return null;
}
