import { useEffect, useMemo, useState } from "react";
import { type OpenedBook, openEpub, protectionOf } from "../archive/epub/open";
import { sanitiseChapter } from "../archive/epub/sanitise";
import { IconGlyph } from "../icons/IconGlyph";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { BookHighlights } from "./BookHighlights";
import { useBookPosition, useBookStore } from "./bookStore";
import { HighlightFocus } from "./HighlightFocus";
import { HighlightMenu } from "./HighlightMenu";
import { HighlightPalette } from "./HighlightPalette";
import { beginHighlightDrag, useHighlightDrag } from "./highlightDrag";
import { promoteAnnotation } from "./promote";
import { type PendingSelection, ReaderChapter } from "./ReaderChapter";
import { useBookBytes } from "./useBookBytes";
import { useHighlights } from "./useHighlights";
import "../styles/reader.css";

export interface BookReaderProps {
  /** The attachment whose bytes this block names. */
  attachmentId: string;
  mime: string;
  name: string;
  /**
   * The card that holds this block, which is what a highlight is recorded against.
   *
   * Absent in a surface with no card behind it, and then the book is read-only: a highlight needs somewhere to
   * live, and inventing an owner would put marks in a document that cannot find them again.
   */
  sourceCardId?: string | undefined;
  /** Open the book large, which is where the drag-out gesture starts. */
  onExpand?: (() => void) | undefined;
  /**
   * The bytes, when the caller already has them.
   *
   * A story and a preview have a fixture in hand and no attachment row to read; every other surface leaves this
   * alone and the reader resolves its own bytes, local copy first.
   */
  source?: { readonly status: "ready"; readonly bytes: Uint8Array } | undefined;
}

type State =
  | { readonly status: "loading" }
  | { readonly status: "refused"; readonly reason: string }
  | { readonly status: "open"; readonly book: OpenedBook };

/**
 * A book, read.
 *
 * One chapter at a time, in our own markup and our own type. The chapter is sanitised before it is drawn, and
 * a highlight is stored as the words it covers — never an offset — because the column is as wide as the card
 * this week and something else next week.
 */
export function BookReader({
  attachmentId,
  name,
  sourceCardId,
  onExpand,
  source,
}: BookReaderProps) {
  const loaded = useBookBytes(attachmentId);
  const bytes = source ?? loaded;
  const [state, setState] = useState<State>({ status: "loading" });
  const [chapterPath, setChapterPath] = useState<string | null>(null);
  const [chapterXml, setChapterXml] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "contents" | "highlights">("none");
  const remembered = useBookPosition(attachmentId);
  const remember = useBookStore((store) => store.remember);
  const highlights = useHighlights(sourceCardId ?? "");
  const workspace = useCanvasStore((state) => state.workspace);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  /** The highlight on the raised surface, by id: a press raises, and the surface is where it is taken apart. */
  const [raisedId, setRaisedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  // Derived *after* the state it reads. A derived value above the `useState` that feeds it is a temporal dead zone:
  // a crash on the first render of a book that has highlights, and nothing at all in a book that has none.
  const raised = highlights.annotations.find((entry) => entry.id === raisedId) ?? null;
  // The properties a promoted highlight can fill: the type's own fields, so a reader can point a part at a property
  // that already means something rather than typing a name and hoping.
  const fieldNames = (workspace?.listTypes() ?? [])
    .flatMap((type) => type.fields)
    .filter((field) => field.kind === "text" || field.kind === "select")
    .map((field) => field.name)
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 12);

  useEffect(() => {
    if (bytes.status === "loading") return;
    if (bytes.status === "missing") {
      setState({ status: "refused", reason: bytes.reason });
      return;
    }
    let cancelled = false;
    void protectionOf(bytes.bytes)
      .then((protection) => {
        if (protection !== null) throw new Error(protection);
        return openEpub(bytes.bytes);
      })
      .then((book) => {
        if (cancelled) return;
        setState({ status: "open", book });
        const first =
          remembered !== null && book.chapters.includes(remembered) ? remembered : book.chapters[0];
        setChapterPath(first ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "refused",
            reason: error instanceof Error ? error.message : "This book could not be opened.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // `remembered` is read once, on purpose: a reader turning a page must not restart the parse.
  }, [bytes, remembered]);

  // One chapter is decompressed at a time, when it is the chapter being read: a book is hundreds of kilobytes
  // of markup and a reader who opens the contents should not pay for all of it.
  useEffect(() => {
    if (state.status !== "open" || chapterPath === null) return;
    let cancelled = false;
    void state.book.readChapter(chapterPath).then((xml) => {
      if (!cancelled) setChapterXml(xml);
    });
    return () => {
      cancelled = true;
    };
  }, [state, chapterPath]);

  const markup = useMemo(() => {
    if (chapterXml === null || chapterPath === null) return { html: "", report: null };
    const sanitised = sanitiseChapter(chapterXml, chapterPath);
    return { html: sanitised.html, report: sanitised.report };
  }, [chapterXml, chapterPath]);

  if (bytes.status === "loading") {
    return (
      <p className="reader-note" data-testid="book-loading">
        Opening the book…
      </p>
    );
  }
  if (state.status === "refused") {
    return (
      <p className="reader-note" data-testid="book-refused">
        <IconGlyph icon="lucide:book-x" size={13} />
        {state.reason}
        <span className="reader-note-name">{name}</span>
      </p>
    );
  }
  if (state.status === "loading" || chapterPath === null) {
    return <p className="reader-note">This book has no chapters to open.</p>;
  }

  const { book } = state;
  const contents = book.book.toc.length > 0 ? book.book.toc : fallbackContents(book);

  const pick = (path: string) => {
    setChapterPath(path);
    setPanel("none");
    remember(attachmentId, path);
  };

  return (
    <div
      className="reader"
      data-testid="book-reader"
      data-handbook-region="book-reader"
      style={{ position: "relative" }}
    >
      <header className="reader-head">
        <button
          type="button"
          className="views-icon-button"
          aria-label="Contents"
          title="Contents"
          aria-expanded={panel === "contents"}
          data-testid="reader-contents-toggle"
          onClick={() => setPanel((open) => (open === "contents" ? "none" : "contents"))}
        >
          <IconGlyph icon="lucide:list" size={14} />
        </button>
        <button
          type="button"
          className="views-icon-button"
          aria-label="Highlights"
          aria-expanded={panel === "highlights"}
          data-testid="reader-highlights-toggle"
          title="Your highlights"
          onClick={() => setPanel((open) => (open === "highlights" ? "none" : "highlights"))}
        >
          <IconGlyph icon="lucide:highlighter" size={14} />
        </button>
        <span className="reader-title" title={book.book.title}>
          {book.book.title}
        </span>
        {book.book.creator === null ? null : (
          <span className="reader-meta">{book.book.creator}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="views-icon-button"
            aria-label="Previous chapter"
            data-testid="reader-prev"
            disabled={indexOf(book, chapterPath) <= 0}
            onClick={() => {
              const at = indexOf(book, chapterPath);
              const previous = book.chapters[at - 1];
              if (previous !== undefined) pick(previous);
            }}
          >
            <IconGlyph icon="lucide:chevron-left" size={14} />
          </button>
          <button
            type="button"
            className="views-icon-button"
            aria-label="Next chapter"
            data-testid="reader-next"
            disabled={indexOf(book, chapterPath) >= book.chapters.length - 1}
            onClick={() => {
              const at = indexOf(book, chapterPath);
              const next = book.chapters[at + 1];
              if (next !== undefined) pick(next);
            }}
          >
            <IconGlyph icon="lucide:chevron-right" size={14} />
          </button>
          {onExpand === undefined ? null : (
            <button
              type="button"
              className="views-icon-button"
              aria-label="Read this book large"
              title="Read large"
              data-testid="reader-expand"
              onClick={onExpand}
            >
              <IconGlyph icon="lucide:maximize-2" size={14} />
            </button>
          )}
        </span>
      </header>

      {panel === "highlights" ? (
        <BookHighlights
          annotations={highlights.annotations}
          styles={highlights.styles}
          onOpen={(id) => {
            setRaisedId(id);
            setPanel("none");
          }}
          onCarry={(id, point) => {
            useHighlightDrag.getState().carry(id);
            useHighlightDrag.getState().move(point);
          }}
        />
      ) : null}

      {panel === "contents" ? (
        <ol className="reader-contents" data-testid="reader-contents">
          {contents.map((entry) => (
            <li key={`${entry.path ?? "none"}-${entry.label}`}>
              <button
                type="button"
                className="reader-contents-row"
                style={{ paddingLeft: `${String(6 + entry.depth * 12)}px` }}
                aria-current={entry.path === chapterPath ? "true" : undefined}
                onClick={() => (entry.path === null ? undefined : pick(entry.path))}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="reader-body" data-testid="reader-body">
        {markup.html.length === 0 ? (
          <p className="reader-note">This chapter could not be read.</p>
        ) : (
          <ReaderChapter
            html={markup.html}
            annotations={highlights.annotations}
            styles={highlights.styles}
            onSelect={setSelection}
            onCarry={(annotationId, start, onDrop) =>
              beginHighlightDrag(annotationId, start, onDrop)
            }
            onActivate={(annotationId) => setRaisedId(annotationId)}
            onMenu={(annotationId, point) => setMenu({ id: annotationId, ...point })}
          />
        )}
      </div>

      {raised === null ? null : (
        <HighlightFocus
          key={raised.id}
          annotation={raised}
          styles={highlights.styles}
          slots={highlights.styles.find((entry) => entry.id === raised.styleId)?.recipe ?? []}
          fieldNames={fieldNames}
          onPlace={(parts) => {
            if (workspace === null) return;
            workspace.setAnnotationParts(raised.id, [...parts]);
            const promoted = promoteAnnotation({
              workspace,
              annotation: { ...raised, parts: [...parts] },
              boardId: activeBoardId,
            });
            if (promoted?.existed === true && activeBoardId !== null) {
              // A highlight that already came out of the book takes the reader to that card rather than making a
              // second one: the record names one card, and a silent duplicate would orphan the first from it.
              openCardFocus(promoted.cardId);
            }
            highlights.refresh();
            setRaisedId(null);
          }}
          onDone={(parts) => {
            workspace?.setAnnotationParts(raised.id, [...parts]);
            highlights.refresh();
            setRaisedId(null);
          }}
          onStyle={(styleId) => {
            workspace?.setAnnotationStyle(raised.id, styleId);
            highlights.refresh();
          }}
          onRemove={() => {
            workspace?.deleteAnnotation(raised.id);
            highlights.refresh();
            setRaisedId(null);
          }}
          onClose={() => setRaisedId(null)}
        />
      )}

      {menu === null ? null : (
        <HighlightMenu
          annotation={highlights.annotations.find((entry) => entry.id === menu.id)}
          styles={highlights.styles}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRaise={() => {
            setRaisedId(menu.id);
            setMenu(null);
          }}
          onStyle={(styleId) => {
            workspace?.setAnnotationStyle(menu.id, styleId);
            highlights.refresh();
          }}
          onPlace={() => {
            const annotation = highlights.annotations.find((entry) => entry.id === menu.id);
            if (annotation === undefined || workspace === null) return;
            const promoted = promoteAnnotation({ workspace, annotation, boardId: activeBoardId });
            if (promoted?.existed === true && activeBoardId !== null)
              openCardFocus(promoted.cardId);
            highlights.refresh();
            setMenu(null);
          }}
          onRemove={() => {
            workspace?.deleteAnnotation(menu.id);
            highlights.refresh();
            setMenu(null);
          }}
        />
      )}

      {selection !== null && sourceCardId !== undefined ? (
        <HighlightPalette
          styles={highlights.styles}
          anchor={selection.anchor}
          onPick={(styleId: string) => {
            highlights.add({ styleId, anchor: selection.anchor, excerpt: selection.anchor.quote });
            setSelection(null);
          }}
          onDismiss={() => setSelection(null)}
        />
      ) : null}
    </div>
  );
}

function indexOf(book: OpenedBook, path: string): number {
  return book.chapters.indexOf(path);
}

/** Chapters, when a book has no usable contents page: one entry per spine document. */
function fallbackContents(
  book: OpenedBook,
): { label: string; path: string | null; fragment: null; depth: number }[] {
  return book.chapters.map((path, index) => ({
    label: `Chapter ${String(index + 1)}`,
    path,
    fragment: null,
    depth: 0,
  }));
}
