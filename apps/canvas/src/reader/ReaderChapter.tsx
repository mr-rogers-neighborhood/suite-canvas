import type { Annotation } from "@suite/graph";
import { ANNOTATION_QUOTE_MAX_LENGTH } from "@suite/graph";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { chapterTextIndex, surroundings } from "../archive/anchor";
import { resolveQuote } from "../archive/anchor/resolve";
import type { TextIndex } from "../archive/anchor/textIndex";
import { IconGlyph } from "../icons/IconGlyph";
import {
  type DragRect,
  isAreaDrag,
  normalisedRect,
  quoteInRect,
  rectBetween,
  rectsOf,
} from "./areaHighlight";

/**
 * A chapter, drawn, with its highlights painted over the words they cover.
 *
 * A book is untrusted markup, so drawing one is the single place in the app that renders a string as DOM. It is
 * one function in one file for that reason: `sanitiseChapter` decides what survives, this component renders the
 * result, and `scripts/check-shape.mjs` names the file so a second injection site cannot appear quietly.
 */
export interface PendingSelection {
  readonly anchor: Extract<Annotation["anchor"], { kind: "quote" }>;
  /**
   * Where the words are, in viewport coordinates.
   *
   * A palette pinned to the bottom of the reader is a palette the reader has to find: the selection it acts on is under
   * their eyes, so the buttons belong there. The rect is reported as the browser measured it and the host converts it,
   * because the chapter does not know what the palette's offset parent is.
   */
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface ReaderChapterProps {
  /** The sanitiser's output. */
  html: string;
  /**
   * This chapter's path inside the book, which is what a highlight records and what decides whether a recorded one
   * belongs on this page.
   *
   * A highlight used to record the chapter's *length*, so nothing could tell one chapter's marks from another's: a
   * quote repeated in chapter nine was painted in chapter two as well, and every chapter counted all the other
   * chapters' highlights as "not in this chapter".
   */
  locator: string;
  annotations: readonly Annotation[];
  styles: readonly { id: string; color: string }[];
  onSelect: (selection: PendingSelection) => void;
  /** A press on a painted highlight: it is raised, and the raised surface holds every verb. */
  onActivate: (annotationId: string) => void;
  /** A right-click on a painted highlight: the same verbs, without raising it. */
  onMenu: (annotationId: string, point: { x: number; y: number }) => void;
  /** A press that travels: the highlight is carried out of the book. */
  onCarry: (
    annotationId: string,
    start: { x: number; y: number },
    onDrop: ((annotationId: string, screen: { x: number; y: number }) => void) | null,
  ) => void;
  /**
   * Called after every paint, once the marks are in the DOM.
   *
   * The marks arrive in a commit of their own: the chapter's markup and its annotations do not land together, so a host
   * that wants to scroll to a passage has nothing to wait on but this. Guessing at the ordering is what made the first
   * attempt at "reopen at the passage" scroll nothing at all.
   */
  onPainted?: ((report: PaintReport) => void) | undefined;
  /**
   * A footnotes-and-contents link, which the sanitiser rewrote into `#<archive path>[#<fragment>]`.
   *
   * The chapter cannot follow one itself: another document is another read, and the reader owns which chapter is
   * open. A link to a place in *this* chapter needs nothing from the caller and is scrolled here.
   */
  onNavigate: (path: string, fragment: string | null) => void;
  /**
   * Marking areas rather than runs of words.
   *
   * Off by default: a reader dragging over a sentence wants the sentence, and a mode that turned every drag into a
   * rectangle would be a mode they never asked for. While it is on, the browser's own selection is suppressed and a drag
   * reports the words under the rectangle instead.
   */
  areaMode?: boolean | undefined;
  /** The rectangle being drawn, in viewport coordinates, for the host to draw over the page. */
  onAreaDrag?: ((rect: DragRect | null) => void) | undefined;
}

export function ReaderChapter({
  html,
  locator,
  annotations,
  styles,
  onSelect,
  onActivate,
  onMenu,
  onCarry,
  onNavigate,
  onPainted,
  areaMode = false,
  onAreaDrag,
}: ReaderChapterProps) {
  const container = useRef<HTMLDivElement | null>(null);

  // Painting is done here rather than in the markup, so a highlight is a mark on rendered text and never a
  // second copy of it: the chapter is the source, and the mark is a wrapper around a range.
  const [unplaced, setUnplaced] = useState(0);

  // `html` is a dependency even though the effect never reads it: a new chapter *replaces* the container's children
  // through `dangerouslySetInnerHTML`, so without it the effect never runs again and the marks are simply gone — which
  // is exactly how every page turn used to lose its highlights. `locator` travels with the same markup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chapter's markup is the invalidation signal.
  useEffect(() => {
    const root = container.current;
    if (root === null) return;
    const report = paintHighlights(root, { locator, annotations, styles });
    paintAreas(root, { locator, annotations, styles });
    // Written only when it changes: painting runs on every annotation change, and a state write per paint is a render
    // per paint.
    setUnplaced((current) => (current === report.unplaced ? current : report.unplaced));
    onPainted?.(report);
  }, [html, locator, annotations, styles]);

  const capture = useCallback(() => {
    const root = container.current;
    if (root === null) return;
    const pending = selectionAnchor(root, locator);
    if (pending === null) return;
    const range = window.getSelection()?.getRangeAt(0);
    const rect = range?.getBoundingClientRect();
    onSelect({
      anchor: pending,
      rect: {
        left: rect?.left ?? 0,
        top: rect?.top ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      },
    });
  }, [onSelect, locator]);

  /**
   * Beginning an area drag.
   *
   * The press is taken over (`preventDefault`, pointer capture) so the browser does not start its own selection: two
   * selections at once is a rectangle drawn over words that are also being dragged across the shell.
   */
  const areaStart = useRef<{ x: number; y: number } | null>(null);
  const startArea = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!areaMode || event.button !== 0) return;
      event.preventDefault();
      areaStart.current = { x: event.clientX, y: event.clientY };
      onAreaDrag?.({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
    },
    [areaMode, onAreaDrag],
  );

  const moveArea = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = areaStart.current;
      if (start === null) return;
      onAreaDrag?.(rectBetween(start, { x: event.clientX, y: event.clientY }));
    },
    [onAreaDrag],
  );

  /** Finishing a drag: the words under the rectangle become an ordinary passage highlight with the rectangle beside it. */
  const endArea = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = areaStart.current;
      areaStart.current = null;
      onAreaDrag?.(null);
      const root = container.current;
      if (start === null || root === null) return;
      const drag = rectBetween(start, { x: event.clientX, y: event.clientY });
      if (!isAreaDrag(drag)) return;
      const box = root.getBoundingClientRect();
      const rect = normalisedRect(drag, box);
      if (rect === null) return;
      const quote = quoteInRect(root, drag, ANNOTATION_QUOTE_MAX_LENGTH);
      // A rectangle over a picture has no words in it, and a highlight needs words: saying nothing is the honest answer,
      // because the alternative is a record whose anchor cannot be repainted.
      if (quote.length === 0) return;
      onSelect({
        anchor: { kind: "quote", locator, quote, prefix: "", suffix: "", rects: [rect] },
        rect: drag,
      });
    },
    [locator, onAreaDrag, onSelect],
  );

  return (
    <>
      {unplaced === 0 ? null : (
        <p className="reader-note" data-testid="reader-unplaced">
          <IconGlyph icon="lucide:highlighter" size={13} />
          {unplaced === 1
            ? "One highlight is not in this chapter."
            : `${String(unplaced)} highlights are not in this chapter.`}
        </p>
      )}
      {/* A chapter is words, not a control: the gesture is the browser's own selection. The keyboard path is the marks
          themselves, which are focusable once painted. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the interaction is text selection. */}
      <div
        ref={container}
        className="reader-chapter"
        onMouseUp={capture}
        // A press and a drag in area mode belong to the rectangle, not to the words: the two gestures would otherwise
        // both fire, and the passage highlight would be the one the reader did not ask for.
        onPointerMove={areaMode ? moveArea : undefined}
        onPointerUp={areaMode ? endArea : undefined}
        style={areaMode ? { cursor: "crosshair", userSelect: "none" } : undefined}
        onKeyDown={(event) => {
          const mark = (event.target as HTMLElement | null)?.closest?.("mark[data-annotation-id]");
          const id = mark?.getAttribute("data-annotation-id");
          if (id === null || id === undefined || id.length === 0) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onActivate(id);
            return;
          }
          if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            const box = mark?.getBoundingClientRect();
            onMenu(id, { x: box?.right ?? 0, y: box?.bottom ?? 0 });
          }
        }}
        onPointerDown={(event) => {
          // In area mode the press belongs to the rectangle: a mark under it is covered by the area being drawn, which
          // is what the reader is looking at.
          if (areaMode) {
            startArea(event);
            return;
          }
          // A press on a mark starts the drag; the press itself is answered by the click handler below, which fires
          // only when the pointer never travelled.
          const mark = (event.target as HTMLElement).closest("mark[data-annotation-id]");
          const id = mark?.getAttribute("data-annotation-id");
          if (id === null || id === undefined || id.length === 0) return;
          // The default press begins the browser's own selection, and a drag then drags that selection across the
          // shell: the reader ends up with half the window highlighted, which is both ugly and unrelated to what
          // they were carrying.
          event.preventDefault();
          onCarry(id, { x: event.clientX, y: event.clientY }, null);
        }}
        onClick={(event) => {
          // A press on a mark is a press on the highlight, and a press anywhere else is a press on the words: the
          // selection gesture must not be mistaken for a promotion.
          const target = event.target as HTMLElement;
          const mark = target.closest("mark[data-annotation-id]");
          const id = mark?.getAttribute("data-annotation-id");
          if (id !== null && id !== undefined && id.length > 0) onActivate(id);
          const link = target.closest("a[href^='#']");
          const href = link?.getAttribute("href");
          if (href === null || href === undefined || href.length <= 1) return;
          // The sanitiser's own shape: `#<archive path>` or `#<archive path>#<fragment>`, and a bare `#fragment` for a
          // mark inside this chapter. Nothing here is a URL, so there is no third case to fall through to.
          event.preventDefault();
          const [path = "", fragment] = href.slice(1).split("#");
          if (path.length === 0) {
            if (fragment !== undefined) scrollToId(container.current, fragment);
            return;
          }
          onNavigate(path, fragment ?? null);
        }}
        onContextMenu={(event) => {
          const mark = (event.target as HTMLElement).closest("mark[data-annotation-id]");
          const id = mark?.getAttribute("data-annotation-id");
          if (id === null || id === undefined || id.length === 0) return;
          event.preventDefault();
          onMenu(id, { x: event.clientX, y: event.clientY });
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the one allowed injection site, after `sanitiseChapter`.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

/**
 * The words a reader has selected, as a quote anchor.
 *
 * The flat text comes from the chapter as it stands, so the anchor is the words themselves plus what is around
 * them: the only form that survives a resize, a theme change and the same book at another width.
 */
function selectionAnchor(
  root: HTMLElement,
  locator: string,
): Extract<Annotation["anchor"], { kind: "quote" }> | null {
  const selected = window.getSelection();
  if (selected === null || selected.isCollapsed || selected.rangeCount === 0) return null;
  const range = selected.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const quote = selected.toString().replace(/\s+/gu, " ").trim();
  if (quote.length === 0) return null;

  const index = chapterTextIndex(root);
  const start = offsetOf(index.runs, range.startContainer, range.startOffset);
  const end = offsetOf(index.runs, range.endContainer, range.endOffset);
  const around =
    start === null || end === null
      ? { prefix: "", suffix: "" }
      : surroundings(index.text, start, end);

  return {
    kind: "quote",
    locator,
    quote,
    prefix: around.prefix,
    suffix: around.suffix,
  };
}

function offsetOf(
  runs: readonly { node: Node; start: number; end: number }[],
  node: Node,
  offset: number,
): number | null {
  const run = runs.find((candidate) => candidate.node === node);
  return run === undefined ? null : run.start + offset;
}

/** What painting a chapter achieved, so the reader can be told when it achieved less than everything. */
export interface PaintReport {
  /** Highlights that found their words and were drawn. */
  readonly painted: number;
  /** Highlights this chapter holds whose words could not be found, or could not be wrapped. */
  readonly unplaced: number;
}

/**
 * Painting a chapter's marks, from a clean page.
 *
 * Two rules make this the reset it has to be. Painting starts by **unwrapping** every mark already in the chapter,
 * because a repaint that wrapped again would nest a `<mark>` inside the previous one on every restyle until the words
 * were thirty elements deep — and the offsets the next pass reads would be the ones the last pass left behind. And it
 * paints only the highlights that belong to **this** chapter, which is what `locator` now answers.
 *
 * A highlight that cannot be placed is not painted, and the reader is told rather than shown a mark in the wrong
 * sentence: a highlight in the wrong place is a lie the reader cannot detect.
 *
 * A mark is painted **per text node**. `Range.surroundContents` throws as soon as a range partially contains an
 * element, so a passage covering a bold word, a link or a paragraph break used to be dropped by the `catch` below with
 * nothing said: "the *first* sentence" simply vanished. Segmenting first means every wrap sits inside one text node,
 * where `surroundContents` cannot fail, and a mark crossing three elements becomes three adjacent marks that share the
 * highlight's id and read as one passage.
 */
function paintHighlights(
  root: HTMLElement,
  chapter: {
    locator: string;
    annotations: readonly Annotation[];
    styles: readonly { id: string; color: string }[];
  },
): PaintReport {
  unwrapMarks(root);

  const index = chapterTextIndex(root);
  const marks: { segment: Range; color: string; id: string }[] = [];
  let painted = 0;
  let unplaced = 0;

  for (const annotation of chapter.annotations) {
    if (annotation.anchor.kind !== "quote") continue;
    const home = chapterOf(annotation.anchor.locator, chapter.locator);
    // Somebody else's chapter: not painted, and not reported either. A reader turning the page has not lost anything,
    // and the old code counted every other chapter's marks as "not in this chapter".
    if (home === "elsewhere") continue;
    const found = resolveQuote(index.text, annotation.anchor);
    const segments = found.status === "found" ? segmentsOf(index, found.start, found.end) : [];
    if (segments.length === 0) {
      // An unknown home is a record written before the anchor named a chapter. It paints where it resolves, and it is
      // never counted: there is no honest answer to "which chapter lost it".
      if (home === "unknown") continue;
      unplaced += 1;
      continue;
    }
    const style = chapter.styles.find((entry) => entry.id === annotation.styleId);
    const color = style?.color ?? "var(--accent)";
    for (const segment of segments) marks.push({ segment, color, id: annotation.id });
    painted += 1;
  }

  // Right to left, so wrapping one segment cannot move the offsets of the next: splitting a text node only ever
  // changes what lies to its right.
  const ordered = marks.sort((a, b) =>
    b.segment.compareBoundaryPoints(Range.START_TO_START, a.segment),
  );
  for (const item of ordered) {
    const wrapper = document.createElement("mark");
    wrapper.className = "reader-highlight";
    wrapper.dataset.annotationId = item.id;
    wrapper.style.background = `color-mix(in srgb, ${item.color} 45%, transparent)`;
    wrapper.style.borderBottom = `2px solid ${item.color}`;
    // A mark is focusable and a keyboard can operate it: one that needs a mouse is a highlight half the readers
    // cannot open.
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "button");
    try {
      item.segment.surroundContents(wrapper);
    } catch {
      // The words stay, and the report tells the reader a mark is missing rather than leaving them to notice.
      unplaced += 1;
    }
  }

  return { painted, unplaced };
}

/**
 * Painting the rectangles area highlights were drawn with, over the words they cover.
 *
 * A second layer rather than more marks: a rectangle is one box over several lines and possibly over a picture, which no
 * amount of wrapping text nodes can draw. It is `pointer-events: none` so every press still reaches the mark underneath,
 * and it is rebuilt from scratch on each paint for the same reason the marks are unwrapped on each paint: the chapter is
 * the source, and the layer is a drawing of it.
 *
 * A rectangle drifts when the book reflows — it was measured against one column width — so it is decoration on a
 * highlight that still knows its words. When a chapter's rectangle lands somewhere absurd, the words are what a reader
 * presses and the words are still right.
 */
function paintAreas(
  root: HTMLElement,
  chapter: {
    locator: string;
    annotations: readonly Annotation[];
    styles: readonly { id: string; color: string }[];
  },
): void {
  for (const old of root.querySelectorAll(".reader-areas")) old.remove();
  const layer = document.createElement("div");
  layer.className = "reader-areas";
  layer.setAttribute("aria-hidden", "true");
  const rootBox = root.getBoundingClientRect();
  for (const annotation of chapter.annotations) {
    const rects = rectsOf(annotation);
    if (rects.length === 0) continue;
    if (annotation.anchor.kind !== "quote") continue;
    if (chapterOf(annotation.anchor.locator, chapter.locator) === "elsewhere") continue;
    const colour =
      chapter.styles.find((entry) => entry.id === annotation.styleId)?.color ?? "var(--accent)";
    const paint = (box: HTMLElement) => {
      box.className = "reader-area";
      box.style.background = `color-mix(in srgb, ${colour} 22%, transparent)`;
      layer.append(box);
    };

    /**
     * The words decide the box whenever the chapter still has them.
     *
     * A stored rectangle is a fraction of the column, measured at one text size on one screen, so it drifts the moment the
     * reader changes either — and the words do not. Painting over the marks the painter has just placed means the box
     * follows the passage through a reflow instead of hanging where it was first drawn; one box per line the passage runs
     * over is also what an area highlight should look like once it settles.
     *
     * The stored rectangle is still the record, and still what is painted when the words cannot be found: a medium with no
     * text to resolve has nothing better.
     */
    const marks = [...root.querySelectorAll<HTMLElement>("mark[data-annotation-id]")].filter(
      (mark) => mark.getAttribute("data-annotation-id") === annotation.id,
    );
    const boxes = marks.flatMap((mark) => [...mark.getClientRects()]);
    if (boxes.length > 0) {
      for (const box of boxes) {
        const div = document.createElement("div");
        div.style.left = `${String(box.left - rootBox.left)}px`;
        div.style.top = `${String(box.top - rootBox.top)}px`;
        div.style.width = `${String(box.width)}px`;
        div.style.height = `${String(box.height)}px`;
        paint(div);
      }
      continue;
    }
    for (const rect of rects) {
      const div = document.createElement("div");
      div.style.left = `${String(rect.x * 100)}%`;
      div.style.top = `${String(rect.y * 100)}%`;
      div.style.width = `${String(rect.width * 100)}%`;
      div.style.height = `${String(rect.height * 100)}%`;
      paint(div);
    }
  }
  // Prepended, so the layer sits before the words: the text is drawn over its own highlight, not through it.
  if (layer.childElementCount > 0) root.prepend(layer);
}

/**
 * Scrolls a chapter to the element a link named, if this chapter still has it.
 *
 * `element.id === id` rather than a selector, because an anchor written by a publisher can be anything a selector
 * would have to escape, and a footnote numbered `1` would otherwise throw inside a click handler.
 */
export function scrollToId(root: HTMLElement | null, id: string): boolean {
  if (root === null) return false;
  for (const element of root.querySelectorAll("[id]")) {
    if (element.id !== id) continue;
    // Optional for the same reason `scrollToAnnotation`'s is: an engine without it must not break the link press.
    element.scrollIntoView?.({ block: "start" });
    return true;
  }
  return false;
}

/**
 * Scrolls a chapter to one highlight, and centres it.
 *
 * A mark is the one element that knows where a passage actually is on the page: the painter put it there this render, so
 * its box is the sentence's box. `block: "center"` rather than `"start"` because the point is to *show* the passage, and
 * a line at the very top edge reads as "this is where you are" about as well as a line at the bottom does.
 *
 * False when the chapter does not hold that mark, which is the honest answer for a highlight that resolves nowhere: a
 * reader who is not moved should not be left believing the book jumped.
 */
export function scrollToAnnotation(root: HTMLElement | null, annotationId: string): boolean {
  if (root === null) return false;
  // Compared, not interpolated into a selector: an id that arrived from another client is not a place to build one.
  for (const mark of root.querySelectorAll("mark[data-annotation-id]")) {
    if (mark.getAttribute("data-annotation-id") !== annotationId) continue;
    // Optional on purpose: scrolling is a courtesy, and a surface without it (a test environment, an old engine) must not
    // lose the raise that came with it.
    mark.scrollIntoView?.({ block: "center" });
    return true;
  }
  return false;
}

/**
 * Removes every mark this painter put there, keeping the words that were inside them.
 *
 * Unwrapping rather than re-rendering the chapter keeps the reader's place: replacing the markup on every restyle would
 * throw away the scroll position and any live selection, and the chapter is not ours to rewrite once it is drawn.
 *
 * Normalised after, because unwrapping leaves the text nodes it split in place — harmless for offsets, but a chapter
 * whose nodes number in the thousands after a hundred repaints is a chapter that gets slower every time somebody
 * changes a colour.
 */
function unwrapMarks(root: HTMLElement): void {
  for (const mark of [...root.querySelectorAll("mark[data-annotation-id]")]) {
    mark.replaceWith(...mark.childNodes);
  }
  root.normalize();
}

/**
 * Whether a recorded locator names this chapter.
 *
 * `elsewhere` is the ordinary answer and means "not on this page". `unknown` is a record written before the anchor
 * named a chapter at all: schema 5 stored the chapter's character count, which is indistinguishable from a spine index
 * and matches no path, so those records are painted wherever they resolve and never counted as lost. There is no
 * migration script for the same reason the schema-5 part target has none — a reader that tolerates the old shape is
 * the whole repair.
 */
function chapterOf(recorded: string, locator: string): "here" | "elsewhere" | "unknown" {
  if (recorded === locator) return "here";
  if (recorded.length > 0 && /^\d+$/u.test(recorded)) return "unknown";
  return "elsewhere";
}

/**
 * One range per text node the passage covers.
 *
 * Taken from the chapter's own text index rather than from a DOM range: the index already says which text node holds
 * which flat offset, so the intersection of a passage with a node is arithmetic, and no boundary case has to be
 * reconstructed from a range's containers.
 */
function segmentsOf(index: TextIndex, start: number, end: number): Range[] {
  const segments: Range[] = [];
  for (const run of index.runs) {
    const from = Math.max(start, run.start);
    const to = Math.min(end, run.end);
    if (to <= from) continue;
    // The newline between two blocks is part of the passage and has nothing to paint on.
    if ((run.node.nodeValue ?? "").trim().length === 0) continue;
    const segment = document.createRange();
    segment.setStart(run.node, from - run.start);
    segment.setEnd(run.node, to - run.start);
    segments.push(segment);
  }
  return segments;
}
