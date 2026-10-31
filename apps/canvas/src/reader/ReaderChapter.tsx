import type { Annotation } from "@suite/graph";
import { useCallback, useEffect, useRef } from "react";
import { chapterTextIndex, rangeOf, surroundings } from "../archive/anchor";
import { resolveQuote } from "../archive/anchor/resolve";

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
  annotations: readonly Annotation[];
  styles: readonly { id: string; color: string }[];
  onSelect: (selection: PendingSelection) => void;
  /** A press on a painted highlight: the card it becomes, or the passage reopened. */
  onActivate: (annotationId: string) => void;
  /** A press that travels: the highlight is carried out of the book. */
  onCarry: (
    annotationId: string,
    start: { x: number; y: number },
    onDrop: ((annotationId: string, screen: { x: number; y: number }) => void) | null,
  ) => void;
}

export function ReaderChapter({
  html,
  annotations,
  styles,
  onSelect,
  onActivate,
  onCarry,
}: ReaderChapterProps) {
  const container = useRef<HTMLDivElement | null>(null);

  // Painting is done here rather than in the markup, so a highlight is a mark on rendered text and never a
  // second copy of it: the chapter is the source, and the mark is a wrapper around a range.
  useEffect(() => {
    const root = container.current;
    if (root === null) return;
    paintHighlights(root, annotations, styles);
    // `html` is not a dependency: React has replaced the container's children by the time this runs, so the ref
    // already points at the new markup.
  }, [annotations, styles]);

  const capture = useCallback(() => {
    const root = container.current;
    if (root === null) return;
    const pending = selectionAnchor(root);
    if (pending !== null) onSelect({ anchor: pending });
  }, [onSelect]);

  return (
    // A chapter is words, not a control: the gesture is the browser's own selection, and there is nothing for a
    // key handler to do that the browser does not already do.
    // biome-ignore lint/a11y/noStaticElementInteractions: the interaction is text selection.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the marks' own Enter handler, below.
    <div
      ref={container}
      className="reader-chapter"
      onMouseUp={capture}
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
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the one allowed injection site, after `sanitiseChapter`.
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
    locator: index.text.length.toString(),
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

/**
 * Wrappers around every highlight that still finds its words.
 *
 * A highlight that cannot be placed is not painted, and the reader is told rather than shown a mark in the wrong
 * sentence: a highlight in the wrong place is a lie the reader cannot detect.
 */
function paintHighlights(
  root: HTMLElement,
  annotations: readonly Annotation[],
  styles: readonly { id: string; color: string }[],
): void {
  const index = chapterTextIndex(root);
  const placed: { start: number; end: number; color: string; id: string }[] = [];

  for (const annotation of annotations) {
    if (annotation.anchor.kind !== "quote") continue;
    const found = resolveQuote(index.text, annotation.anchor);
    if (found.status !== "found") continue;
    const style = styles.find((entry) => entry.id === annotation.styleId);
    placed.push({
      start: found.start,
      end: found.end,
      color: style?.color ?? "var(--accent)",
      id: annotation.id,
    });
  }

  // Right to left, so wrapping one span cannot move the offsets of the next.
  for (const item of placed.sort((a, b) => b.start - a.start)) {
    const range = rangeOf(index, item.start, item.end);
    if (range === null) continue;
    const mark = document.createElement("mark");
    mark.className = "reader-highlight";
    mark.dataset.annotationId = item.id;
    mark.style.background = `color-mix(in srgb, ${item.color} 45%, transparent)`;
    mark.style.borderBottom = `2px solid ${item.color}`;
    try {
      range.surroundContents(mark);
    } catch {
      // A range crossing an element boundary cannot be wrapped; the words stay and the mark is skipped rather
      // than splitting the chapter's markup.
    }
  }
}
