import type { Card } from "@suite/graph";
import { useEffect } from "react";
import { MEDIA_NODE_NAME } from "../editor/mediaNode";
import { IconGlyph } from "../icons/IconGlyph";
import { BookReader } from "../reader/BookReader";
import { bookEntryOf, loadBook, retryBook, useBookMeta } from "../reader/bookMeta";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * A book on the canvas.
 *
 * The card *is* the book: the cover fills it the way a picture fills an image card, and the details a reader wants
 * before deciding to read sit under it — the title, the author, how many chapters, and **Read**.
 *
 * The cover is not drawn by reading the archive here. `loadBook` does that once, off the paint, and publishes what it
 * found; this face subscribes. A board of forty cards is forty faces before anybody clicks, so the tile arrives first
 * and the picture after it, and the card does not change shape when it does.
 */
export function BookCardFace({ card }: { card: Card }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const isCanvasReader = useUiStore((state) => Boolean(state.canvasReaderCardIds[card.id]));
  const toggleCanvasReader = useUiStore((state) => state.toggleCanvasReader);
  const file = workspace === null ? null : bookBlockOf(workspace, card.id);
  const attachmentId = file?.id ?? "";

  // Subscribing rather than reading once: the load finishes after this face has painted.
  const entry = useBookMeta((state) => state.entries[attachmentId]);

  useEffect(() => {
    if (attachmentId.length === 0) return;
    loadBook(attachmentId);
    // A face that remounts is a second chance: the bytes may have landed since the last attempt gave up waiting.
    retryBook(attachmentId);
  }, [attachmentId]);

  const ready = entry?.status === "ready" ? entry : null;
  const title = ready?.meta.title ?? file?.name ?? "Untitled book";
  const author = ready?.meta.creator ?? "Book";

  if (isCanvasReader && attachmentId.length > 0) {
    return (
      <div className="book-canvas-reader nodrag nopan" data-testid="book-canvas-reader">
        <div className="book-canvas-reader-bar shrink-0">
          <button
            type="button"
            className="views-icon-button nodrag nopan flex items-center gap-1 text-xs"
            data-testid="book-card-toggle-cover"
            onClick={(event) => {
              event.stopPropagation();
              toggleCanvasReader(card.id);
            }}
            title="Show cover"
          >
            <IconGlyph icon="lucide:arrow-left" size={12} />
            <span>Cover</span>
          </button>
          <span className="truncate font-medium text-[var(--ink)] text-xs px-2">{title}</span>
          <button
            type="button"
            className="views-icon-button nodrag nopan"
            data-testid="book-card-expand-focus"
            onClick={(event) => {
              event.stopPropagation();
              openCardFocus(card.id);
            }}
            title="Read in focus mode"
          >
            <IconGlyph icon="lucide:maximize-2" size={13} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden nodrag nopan">
          <BookReader
            attachmentId={attachmentId}
            name={title}
            sourceCardId={card.id}
            onExpand={() => openCardFocus(card.id)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="book-card" data-testid="book-card-face">
      <div className="book-card-art">
        {ready?.coverUrl === null || ready === null ? (
          // A box that is there before the icon is: the bundled set resolves a tick after the first paint, and a
          // tile that appears late is a card that changed shape.
          <span aria-hidden="true" className="book-card-placeholder">
            <IconGlyph icon="lucide:book-open" size={30} />
          </span>
        ) : (
          // The cover is bytes from the book's own archive, held as an object URL: nothing is fetched from anywhere,
          // so `no-referrer` is the whole of the policy.
          <img
            className="book-card-cover"
            src={ready.coverUrl}
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
          {ready === null
            ? ""
            : ` · ${String(ready.meta.chapters)} ${ready.meta.chapters === 1 ? "chapter" : "chapters"}`}
        </span>
      </div>
      <div className="book-card-actions">
        <button
          type="button"
          className="book-card-read-canvas nodrag nopan"
          data-testid="book-card-read-canvas"
          onClick={(event) => {
            event.stopPropagation();
            toggleCanvasReader(card.id);
          }}
          title="Read on canvas"
        >
          <IconGlyph icon="lucide:book-open" size={12} />
          <span>Read</span>
        </button>
        <button
          type="button"
          // A node is a drag surface: without this the press would start a drag of the card instead of opening the book.
          className="book-card-read nodrag nopan"
          data-testid="book-card-read"
          onClick={(event) => {
            event.stopPropagation();
            openCardFocus(card.id);
          }}
          title="Read large in focus mode"
        >
          Focus
        </button>
      </div>
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

/** The book a card holds, for a surface that needs the attachment rather than the face. */
export function bookOfCard(workspace: Parameters<typeof bookBlockOf>[0], cardId: string) {
  return bookBlockOf(workspace, cardId);
}

export { bookEntryOf };
