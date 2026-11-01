import type { AnnotationPart } from "@suite/graph";
import { ANNOTATION_QUOTE_MAX_LENGTH } from "@suite/graph";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type OpenedBook, openEpub, protectionOf } from "../archive/epub/open";
import { sanitiseChapter } from "../archive/epub/sanitise";
import { toast } from "../feedback/toast";
import { IconGlyph } from "../icons/IconGlyph";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { BookBacklinks } from "./BookBacklinks";
import { BookHighlights } from "./BookHighlights";
import { BookSearchPanel } from "./BookSearchPanel";
import { useBookPosition, useBookStore } from "./bookStore";
import { ChapterNotice } from "./ChapterNotice";
import { imageMime, imagePaths, resolveImages } from "./chapterAssets";
import { HighlightFocus } from "./HighlightFocus";
import { HighlightMenu } from "./HighlightMenu";
import { HighlightPalette } from "./HighlightPalette";
import { handOverHighlight, handOverHighlights } from "./handOver";
import { beginHighlightDrag } from "./highlightDrag";
import {
  type PendingSelection,
  ReaderChapter,
  scrollToAnnotation,
  scrollToId,
} from "./ReaderChapter";
import { useBookBytes } from "./useBookBytes";
import { useBookSearch } from "./useBookSearch";
import { useHighlights } from "./useHighlights";
import "../styles/reader.css";

export interface BookReaderProps {
  /** The attachment whose bytes this block names. */
  attachmentId: string;
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

/** The book's side panels, in the order the header offers them: the words first, then what came out of them. */
const PANELS = [
  {
    panel: "search",
    label: "Search this book",
    icon: "lucide:search",
    testId: "reader-search-toggle",
  },
  { panel: "contents", label: "Contents", icon: "lucide:list", testId: "reader-contents-toggle" },
  {
    panel: "highlights",
    label: "Your highlights",
    icon: "lucide:highlighter",
    testId: "reader-highlights-toggle",
  },
  {
    panel: "cards",
    label: "Cards from this book",
    icon: "lucide:square-stack",
    testId: "reader-cards-toggle",
  },
] as const;

type Panel = (typeof PANELS)[number]["panel"];

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
  /**
   * The chapter the current markup actually belongs to.
   *
   * `chapterPath` changes the instant a page turns, while `chapterXml` still holds the previous chapter until the next
   * read lands, so anything that scrolls to a place in the chapter has to ask *this* rather than the path the reader has
   * already chosen. Without it a link's fragment was applied to the chapter being left behind.
   */
  const [markupPath, setMarkupPath] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | "none">("none");
  /** The book's words, indexed once, and the hit a reader asked to be taken to. */
  const search = useBookSearch(state.status === "open" ? state.book : null);
  const settleHit = search.settle;
  const remembered = useBookPosition(attachmentId);
  /**
   * Where to open this book, read once.
   *
   * `remembered` is a fresh object on every write, and `remember` writes on every page turn and on a 250 ms trailing
   * timer while scrolling. Depending on it directly re-opened the whole archive — the package, the spine, the nav —
   * once per turn, so the reader's own progress was the thing making it slow. This is the position the book opens on
   * and nothing more; a page turn writes it and never reads it back here.
   */
  const [opensAt] = useState(() => remembered);
  const remember = useBookStore((store) => store.remember);
  const highlights = useHighlights(sourceCardId ?? "");
  const workspace = useCanvasStore((state) => state.workspace);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const openAnnotationKinds = useUiStore((state) => state.openAnnotationKinds);
  const focusedAnnotationId = useUiStore((state) => state.focusedAnnotationId);
  const clearFocusedAnnotation = useUiStore((state) => state.clearFocusedAnnotation);
  const bookPanelRequest = useUiStore((state) => state.bookPanelRequest);
  const clearBookPanelRequest = useUiStore((state) => state.clearBookPanelRequest);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  /** The highlight on the raised surface, by id: a press raises, and the surface is where it is taken apart. */
  const [raisedId, setRaisedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  /**
   * Where to scroll the next chapter to.
   *
   * A remembered offset has to wait for the chapter to be in the DOM, and the scroll has to happen once: applying it
   * on every render would fight a reader who scrolled away from where they were put.
   */
  const [pendingOffset, setPendingOffset] = useState(0);
  /** A fragment a link asked for, and the chapter that holds it, waiting until that chapter has been drawn. */
  const [pendingFragment, setPendingFragment] = useState<{
    readonly path: string;
    readonly id: string;
  } | null>(null);
  /**
   * A highlight to scroll to once its chapter is painted.
   *
   * Separate from the fragment because it is answered by a mark rather than an id, and because it survives the chapter
   * not being loaded yet: the reader turns the page, and the scroll happens when the words are on it.
   */
  const [pendingMark, setPendingMark] = useState<{
    readonly path: string;
    readonly id: string;
  } | null>(null);
  /** Bumped by every paint, so a scroll can wait for the marks rather than for a guess about ordering. */
  const [paintRevision, setPaintRevision] = useState(0);
  /** Archive path → object URL for the pictures in this chapter. Revoked when the chapter changes. */
  const [assets, setAssets] = useState<ReadonlyMap<string, string>>(new Map());
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLSpanElement | null>(null);

  // Derived *after* the state it reads. A derived value above the `useState` that feeds it is a temporal dead zone:
  // a crash on the first render of a book that has highlights, and nothing at all in a book that has none.
  const raised = highlights.annotations.find((entry) => entry.id === raisedId) ?? null;

  /**
   * Where the palette goes: under the words that were selected.
   *
   * Measured against the reader's own box rather than the viewport, because the palette is positioned inside it. The
   * x is clamped so a selection at either edge keeps its buttons on the page, and the palette flips above the words when
   * there is no room below them, which is the common case for the last line of a screen.
   */
  const paletteAt = useMemo(() => {
    if (selection === null) return undefined;
    const root = readerRef.current;
    if (root === null) return undefined;
    const box = root.getBoundingClientRect();
    const { rect } = selection;
    const centre = rect.left + rect.width / 2 - box.left;
    const x = Math.min(Math.max(centre, 92), Math.max(92, box.width - 92));
    const below = rect.top + rect.height - box.top + 8;
    const above = rect.top - box.top - 44;
    return { x, y: below + 44 > box.height && above > 0 ? above : below };
  }, [selection]);
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
        // The remembered place, when the book still has that chapter: a book that was edited since must open on
        // something, and the top of the first chapter is a better answer than an empty column.
        const first =
          opensAt !== null && book.chapters.includes(opensAt.path)
            ? opensAt.path
            : book.chapters[0];
        setChapterPath(first ?? null);
        setPendingOffset(opensAt?.offset ?? 0);
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
    // `opensAt` is state, so its identity never changes: listing it is honest and it still cannot re-run this effect.
    // A reader turning a page must not restart the parse — the book (`bytes`) is what this effect is for.
  }, [bytes, opensAt]);

  // One chapter is decompressed at a time, when it is the chapter being read: a book is hundreds of kilobytes
  // of markup and a reader who opens the contents should not pay for all of it.
  useEffect(() => {
    if (state.status !== "open" || chapterPath === null) return;
    let cancelled = false;
    // Cleared while the next chapter is read, so the reader never draws one chapter's words under another chapter's
    // name. The pause is a tick; a stale pairing is a highlight painted against the wrong text.
    setChapterXml(null);
    setMarkupPath(chapterPath);
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

  /**
   * The chapter as it is drawn: the sanitiser's markup, with the pictures pointed at the URLs that loaded.
   *
   * Memoised on its own because `resolveImages` parses the markup, and this component re-renders for reasons that have
   * nothing to do with the chapter: raising a highlight, or opening the contents.
   */
  const chapterHtml = useMemo(() => resolveImages(markup.html, assets), [markup.html, assets]);

  /**
   * The chapter's pictures, as object URLs.
   *
   * The sanitiser leaves an `src` as the archive path, so drawing the chapter without this asks the app's own origin
   * for `OEBPS/images/picture.png` and 404s. The bytes are in the book the reader already has open.
   */
  useEffect(() => {
    const book = state.status === "open" ? state.book : null;
    const paths = book === null ? [] : imagePaths(markup.html);
    if (book === null || paths.length === 0) {
      setAssets((current) => (current.size === 0 ? current : new Map()));
      return;
    }
    let cancelled = false;
    const made: string[] = [];
    void Promise.all(
      paths.map(async (path) => {
        const bytes = await book.readResource(path);
        if (bytes === null || typeof URL.createObjectURL !== "function") return null;
        const url = URL.createObjectURL(
          new Blob([bytes as unknown as BlobPart], { type: imageMime(path) }),
        );
        made.push(url);
        return [path, url] as const;
      }),
    ).then((entries) => {
      if (cancelled) {
        for (const url of made) URL.revokeObjectURL(url);
        return;
      }
      setAssets(
        new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null)),
      );
    });
    return () => {
      cancelled = true;
      // A chapter's pictures are its own: leaving them attached is a leak the reader never notices and never stops.
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [state, markup.html]);

  // The open book, or null while it loads: everything below is a hook, and a hook cannot sit behind an early return.
  const opened = state.status === "open" ? state.book : null;
  const chapterCount = opened?.chapters.length ?? 0;
  const chapterIndex =
    opened === null || chapterPath === null ? 0 : Math.max(0, indexOf(opened, chapterPath));

  /**
   * Where the reader is, written without a render.
   *
   * Scrolling must not re-render the reader: a render repaints the whole chapter and its marks, and a reader dragging
   * the scrollbar would be doing that sixty times a second. So the progress rule is a ref whose width is set directly,
   * and the stored position is written on a trailing timer rather than on every event.
   */
  const rememberTimer = useRef<number | null>(null);
  const applyScroll = useCallback(() => {
    const body = bodyRef.current;
    if (body === null || chapterCount === 0) return;
    const scrolled =
      body.scrollHeight <= body.clientHeight
        ? 0
        : Math.min(1, body.scrollTop / (body.scrollHeight - body.clientHeight));
    const bar = progressRef.current;
    if (bar !== null) {
      const through = chapterCount === 0 ? 0 : (chapterIndex + scrolled) / chapterCount;
      bar.style.width = `${String(Math.round(Math.min(1, through) * 100))}%`;
    }
    if (chapterPath === null) return;
    if (rememberTimer.current !== null) window.clearTimeout(rememberTimer.current);
    rememberTimer.current = window.setTimeout(() => {
      rememberTimer.current = null;
      remember(attachmentId, chapterPath, body.scrollTop);
    }, 250);
  }, [attachmentId, chapterCount, chapterIndex, chapterPath, remember]);

  const pick = useCallback(
    (path: string) => {
      setChapterPath(path);
      setPanel("none");
      // A new chapter starts at its top: carrying the offset over would drop the reader mid-page somewhere they have
      // never been.
      setPendingOffset(0);
      remember(attachmentId, path, 0);
    },
    [attachmentId, remember],
  );

  const turn = (step: number) => {
    const next = opened?.chapters[chapterIndex + step];
    if (next !== undefined) pick(next);
  };

  /**
   * A panel a surface asked for on the way in: "Place more annotations" is this book, at the passage list.
   *
   * Applied on arrival rather than read as the initial state, because the request arrives with the same render that
   * mounts this surface and the panel is the reader's own state from then on.
   */
  useEffect(() => {
    if (bookPanelRequest === null) return;
    setPanel(bookPanelRequest);
    clearBookPanelRequest();
  }, [bookPanelRequest, clearBookPanelRequest]);

  /**
   * Scrolling to a passage once its chapter is on the page.
   *
   * Guarded on the markup being non-empty for the same reason the fragment is: scrolling against the previous chapter
   * would land on a mark that is about to be replaced, which looks like a jump and then a second jump.
   */
  // `paintRevision` is a dependency the effect never reads: it is the signal that the marks arrived, and the scroll it
  // triggers is the whole point of waiting for them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the paint is the invalidation signal.
  useEffect(() => {
    if (pendingMark === null) return;
    if (markupPath !== pendingMark.path || markup.html.length === 0) return;
    // Kept until the mark is really there: the paint is its own commit, so a chapter the painter could not place leaves
    // this waiting rather than scrolling to nothing.
    if (scrollToAnnotation(bodyRef.current, pendingMark.id)) setPendingMark(null);
  }, [pendingMark, markupPath, markup.html, paintRevision]);

  // A search hit, landed once its chapter is the one drawn: `settle` holds it until then.
  useEffect(() => {
    settleHit(bodyRef.current, markupPath ?? "", markup.html.length > 0);
  }, [settleHit, markupPath, markup.html]);

  /**
   * A passage some other surface asked for: the library's Annotations tab, or a `@` mention of a highlight.
   *
   * Those surfaces know the highlight and the book, and neither is inside the reader, so the request arrives through the
   * UI store. Opening it means two things at once: turn to the chapter the passage sits in, so that closing the raised
   * surface leaves the reader where the words are, and raise the passage itself.
   */
  useEffect(() => {
    if (focusedAnnotationId === null || state.status !== "open") return;
    const target = highlights.annotations.find((entry) => entry.id === focusedAnnotationId);
    // A highlight this book does not hold belongs to another source; the store's request is spent either way.
    if (target !== undefined) {
      const locator = target.anchor.locator;
      if (state.book.chapters.includes(locator) && locator !== chapterPath) {
        // The chapter it needs, and the scroll it needs, waiting for that chapter to paint.
        setPendingMark({ path: locator, id: target.id });
        pick(locator);
      } else if (chapterPath !== null) {
        // Already here: scroll now rather than after a chapter that is not coming.
        scrollToAnnotation(bodyRef.current, target.id);
      }
      setRaisedId(target.id);
    }
    clearFocusedAnnotation();
  }, [
    focusedAnnotationId,
    state,
    highlights.annotations,
    chapterPath,
    pick,
    clearFocusedAnnotation,
  ]);

  // The remembered offset is applied once the chapter is in the DOM, and only once: re-applying it would drag a
  // reader back to where they were every time anything re-rendered.
  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    body.scrollTop = pendingOffset;
    applyScroll();
  }, [pendingOffset, applyScroll]);

  /**
   * A link's destination, applied once the chapter that holds it is on the page.
   *
   * Guarded on the chapter matching and on the markup being non-empty, because the two arrive a tick apart: scrolling
   * against the previous chapter's markup would land on an anchor that has the same name in the wrong place.
   */
  useEffect(() => {
    if (pendingFragment === null) return;
    if (markupPath !== pendingFragment.path || markup.html.length === 0) return;
    // A miss is a link to an anchor the book no longer has, and there is nothing more to wait for.
    scrollToId(bodyRef.current, pendingFragment.id);
    setPendingFragment(null);
  }, [pendingFragment, markupPath, markup.html]);

  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    const onScroll = () => applyScroll();
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      body.removeEventListener("scroll", onScroll);
      // A trailing write must not outlive the surface that scheduled it: a timer firing after the book closes writes a
      // position nobody asked for, and this one is occasionally the previous chapter's.
      if (rememberTimer.current !== null) {
        window.clearTimeout(rememberTimer.current);
        rememberTimer.current = null;
      }
    };
  }, [applyScroll]);

  /**
   * Turning pages with the keyboard.
   *
   * The reader is the one surface where this is expected: a book is turned with the arrows and the space bar, and this
   * is the only place in the app that does not. It stands aside for anything that owns the key: a field being typed
   * in, a live selection, a menu, or the raised surface.
   */
  useEffect(() => {
    if (state.status !== "open") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (raisedId !== null || menu !== null || selection !== null) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return;
      }
      // The find bar a reader reaches for, pointed at the book rather than at the page's own markup: the words are in a
      // chapter that is drawn, so the browser's own find would search the whole puzzle of chrome around it.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setPanel("search");
        return;
      }
      const selected = window.getSelection();
      if (selected !== null && !selected.isCollapsed && selected.toString().length > 0) return;
      const body = bodyRef.current;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        if (body !== null && event.key === "PageDown") return;
        event.preventDefault();
        turn(1);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        if (body !== null && event.key === "PageUp") return;
        event.preventDefault();
        turn(-1);
        return;
      }
      if (event.key === " " && !event.shiftKey) {
        event.preventDefault();
        turn(1);
        return;
      }
      if (event.key === " " && event.shiftKey) {
        event.preventDefault();
        turn(-1);
        return;
      }
      if (body === null) return;
      if (event.key === "Home") {
        event.preventDefault();
        body.scrollTop = 0;
        applyScroll();
      }
      if (event.key === "End") {
        event.preventDefault();
        body.scrollTop = body.scrollHeight;
        applyScroll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /**
   * Putting a highlight on the board.
   *
   * The card is made and put in the reader's hand, because placing is a gesture: a press on the board puts it down
   * where they are looking. A highlight whose card already exists is never made twice — the hand takes it back, or the
   * reader is taken to the card when it is already on a board.
   */
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

  const place = (annotationId: string, parts?: readonly AnnotationPart[]) => {
    if (workspace === null) return;
    const found = highlights.annotations.find((entry) => entry.id === annotationId);
    if (found === undefined) return;
    const outcome = handOverHighlight({
      workspace,
      annotation: parts === undefined ? found : { ...found, parts: [...parts] },
      canEditPlacement: canEditLayout,
    });
    // The order matters: a trashed card is neither placed nor in hand, and saying "saved to the inbox" about one would
    // be a sentence about nothing.
    if (outcome.trashed) toast.neutral("Its card is in the trash. Restore it from the library.");
    else if (outcome.placedAlready) openCardFocus(outcome.cardId);
    else if (!outcome.inHand) toast.neutral("Saved to the inbox: this board is read-only for you.");
  };

  return (
    <div
      ref={readerRef}
      className="reader"
      data-testid="book-reader"
      data-handbook-region="book-reader"
      style={{ position: "relative" }}
    >
      <header className="reader-head">
        {PANELS.map((entry) => (
          <button
            key={entry.panel}
            type="button"
            className="views-icon-button"
            aria-label={entry.label}
            title={entry.label}
            aria-expanded={panel === entry.panel}
            data-testid={entry.testId}
            onClick={() => setPanel((open) => (open === entry.panel ? "none" : entry.panel))}
          >
            <IconGlyph icon={entry.icon} size={14} />
          </button>
        ))}
        <span className="reader-title" title={book.book.title}>
          {book.book.title}
        </span>
        {book.book.creator === null ? null : (
          <span className="reader-meta">{book.book.creator}</span>
        )}
        <span className="reader-meta" data-testid="reader-where">
          {`Chapter ${String(chapterIndex + 1)} of ${String(book.chapters.length)}`}
        </span>
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
        {/* Where the reader is in the book, a chapter at a time: the width is written from the scroll rather than
            from state, so reading does not re-render the chapter. */}
        <span className="reader-progress" aria-hidden="true">
          <span className="reader-progress-bar" ref={progressRef} data-testid="reader-progress" />
        </span>
      </header>

      {panel === "cards" ? (
        <BookBacklinks
          bookCardId={sourceCardId ?? ""}
          annotations={highlights.annotations}
          onOpen={(cardId) => openCardFocus(cardId)}
        />
      ) : null}

      {panel === "search" ? (
        <BookSearchPanel
          indexing={search.indexing}
          query={search.query}
          onQuery={search.setQuery}
          chapters={search.results.chapters}
          total={search.results.total}
          onGo={(path, match, occurrence) => {
            // The chapter turns, and the scroll waits for it: the hit is answered once that chapter is drawn.
            search.goTo(path, match, occurrence);
            if (path !== chapterPath) pick(path);
          }}
        />
      ) : null}

      {panel === "highlights" ? (
        <BookHighlights
          annotations={highlights.annotations}
          styles={highlights.styles}
          onPlaceMany={(ids) => {
            if (workspace === null) return;
            const found = ids.flatMap((id) => {
              const annotation = highlights.annotations.find((entry) => entry.id === id);
              return annotation === undefined ? [] : [annotation];
            });
            const outcome = handOverHighlights({
              workspace,
              annotations: found,
              canEditPlacement: canEditLayout,
            });
            if (outcome.trashed > 0) {
              toast.neutral(
                outcome.trashed === 1
                  ? "One of those has its card in the trash. Restore it from the library."
                  : `${String(outcome.trashed)} of those have their cards in the trash. Restore them from the library.`,
              );
            } else if (!outcome.inHand && outcome.cardIds.length > 0) {
              toast.neutral("Those are already on this board.");
            }
          }}
          onOpen={(id) => {
            // The list stays open underneath the raised passage. Closing it made working through a book one passage per
            // visit: raise, finish, and the list you were reading from is gone, so the next one starts with reopening it.
            // The raised surface is a layer over the reader, and this is what it uncovers.
            setRaisedId(id);
          }}
          onPlace={(id) => place(id)}
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

      {/* The sanitiser's own account of what it refused, shown only when a reader would notice the loss. */}
      {markup.report === null ? null : <ChapterNotice report={markup.report} />}

      {/* The ref is what the remembered offset, the progress rule and the scroll-position writes all read, so a reader
          who closes a book halfway down a chapter comes back to it. */}
      <div ref={bodyRef} className="reader-body" data-testid="reader-body">
        {markup.html.length === 0 ? (
          <p className="reader-note">This chapter could not be read.</p>
        ) : (
          <ReaderChapter
            html={chapterHtml}
            locator={chapterPath}
            annotations={highlights.annotations}
            styles={highlights.styles}
            onSelect={setSelection}
            onPainted={() => setPaintRevision((current) => current + 1)}
            onNavigate={(path, fragment) => {
              // A link into another document is a page turn that lands on a place: `pick` resets the offset, and the
              // fragment is applied once the new chapter is in the DOM.
              if (!book.chapters.includes(path)) return;
              if (fragment !== null) setPendingFragment({ path, id: fragment });
              pick(path);
            }}
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
          onEditKinds={openAnnotationKinds}
          onPlace={(parts) => {
            if (workspace === null) return;
            workspace.setAnnotationParts(raised.id, [...parts]);
            // A highlight that already came out of the book is not made twice: its card goes back in the hand, or the
            // reader is taken to it when it is already on a board.
            place(raised.id, [...parts]);
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
          tags={workspace?.listTags() ?? []}
          onTags={(tagIds) => {
            workspace?.setAnnotationTags(raised.id, [...tagIds]);
            highlights.refresh();
          }}
          onNote={(note) => {
            workspace?.setAnnotationNote(raised.id, note);
            highlights.refresh();
          }}
          onClose={() => setRaisedId(null)}
        />
      )}

      {menu === null ? null : (
        <HighlightMenu
          annotation={highlights.annotations.find((entry) => entry.id === menu.id)}
          styles={highlights.styles}
          source={{ title: book.book.title, author: book.book.creator }}
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
          onPlace={() => place(menu.id)}
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
          at={paletteAt}
          onPick={(styleId: string) => {
            const made = highlights.add({
              styleId,
              anchor: selection.anchor,
              excerpt: selection.anchor.quote,
            });
            if (made === null) {
              toast.neutral(
                `That passage is too long to mark. A highlight can hold ${String(
                  ANNOTATION_QUOTE_MAX_LENGTH,
                )} characters — mark a sentence or a paragraph instead.`,
              );
            }
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
