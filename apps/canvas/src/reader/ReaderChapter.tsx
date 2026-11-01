import type { Annotation } from "@suite/graph";
import { useCallback, useEffect, useRef, useState } from "react";
import { chapterTextIndex, surroundings } from "../archive/anchor";
import { resolveQuote } from "../archive/anchor/resolve";
import type { TextIndex } from "../archive/anchor/textIndex";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * A chapter, drawn, with its highlights painted over the words they cover.
 *
 * A book is untrusted markup, so drawing one is the single place in the app that renders a string as DOM. It is
 * one function in one file for that reason: `sanitiseChapter` decides what survives, this component renders the
 * result, and `scripts/check-shape.mjs` names the file so a second injection site cannot appear quietly.
 */
export interface PendingSelection {
  readonly anchor: Extract<Annotation["anchor"], { kind: "quote" }>;
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
    // Written only when it changes: painting runs on every annotation change, and a state write per paint is a render
    // per paint.
    setUnplaced((current) => (current === report.unplaced ? current : report.unplaced));
  }, [html, locator, annotations, styles]);

  const capture = useCallback(() => {
    const root = container.current;
    if (root === null) return;
    const pending = selectionAnchor(root, locator);
    if (pending !== null) onSelect({ anchor: pending });
  }, [onSelect, locator]);

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
          const mark = (event.target as HTMLElement).closest("mark[data-annotation-id]");
          const id = mark?.getAttribute("data-annotation-id");
          if (id !== null && id !== undefined && id.length > 0) onActivate(id);
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
