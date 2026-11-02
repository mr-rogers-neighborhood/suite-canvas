import type { Annotation } from "@suite/graph";

/**
 * Marking an area rather than a run of words.
 *
 * A rectangle is the gesture a reader makes over a table, a figure, or a block of text they cannot be bothered to drag
 * across precisely. What it means is still "these words", so the highlight is the ordinary quote anchor with the
 * rectangle riding beside it: the mark, the promotion, the palette and the outline all keep working unchanged.
 *
 * Two coordinate systems meet here. A drag is measured in the viewport, which is what the pointer reports, and a
 * rectangle is stored as fractions of the chapter's column, which is what survives a resize. The conversion is the only
 * arithmetic worth testing, and it is the only thing in this module that does not need a browser.
 */
export interface DragRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A column: where it starts in the viewport and how big it is. Measured, never guessed. */
export interface ColumnBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The smallest drag that means anything: below this a press is a press, not a selection. */
export const MIN_AREA_SIZE = 6;

/**
 * The drag, as fractions of the column.
 *
 * Clamped rather than refused, because a drag that starts inside the column and leaves it is a reader selecting to the
 * edge, which is what they meant. A zero-height column is the honest answer to a chapter that is not laid out yet, and
 * it is `null` here rather than a division by zero.
 */
export function normalisedRect(
  drag: DragRect,
  box: ColumnBox,
): { x: number; y: number; width: number; height: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x = clamp((drag.left - box.left) / box.width);
  const y = clamp((drag.top - box.top) / box.height);
  const right = clamp((drag.left + drag.width - box.left) / box.width);
  const bottom = clamp((drag.top + drag.height - box.top) / box.height);
  // Right to left, or bottom to top: a drag has a direction the rectangle does not. Rounded to a ten-thousandth of the
  // column, which is a tenth of a pixel at any width and keeps the stored record free of floating-point noise.
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    x: round(Math.min(x, right)),
    y: round(Math.min(y, bottom)),
    width: round(Math.abs(right - x)),
    height: round(Math.abs(bottom - y)),
  };
}

/** The rectangle a pointer travelled between two corners, which is what the reader sees while dragging. */
export function rectBetween(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): DragRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Whether a drag is big enough to mean a selection rather than a press. */
export function isAreaDrag(drag: DragRect): boolean {
  return drag.width >= MIN_AREA_SIZE || drag.height >= MIN_AREA_SIZE;
}

/**
 * The words inside a rectangle, as one passage.
 *
 * Read node by node rather than as one range, because a range that starts and ends mid-tree reports a bounding box
 * around the whole selection: a rectangle over the middle of a paragraph would then claim every line it spans. Testing
 * each text node's own boxes is what makes "the words under the rectangle" mean what it says.
 *
 * Joined with a space so a selection over three paragraphs reads as three paragraphs rather than one run-on word, and
 * collapsed so the indentation of the markup never reaches the quote.
 */
export function quoteInRect(root: HTMLElement, drag: DragRect, limit: number): string {
  const pieces: string[] = [];
  let length = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.trim().length === 0) continue;
    if (!intersects(text, drag)) continue;
    pieces.push(text.data);
    length += text.data.length;
    // A drag over a whole chapter is not a highlight of it: stopped early rather than at the cap, because a quote that
    // has been cut in the middle is worse than one that was refused.
    if (length > limit) return "";
  }
  return (
    pieces
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim()
      // The anchor's own cap, applied to what is kept rather than to what was walked.
      .slice(0, limit)
  );
}

function intersects(text: Text, drag: DragRect): boolean {
  const range = document.createRange();
  range.selectNodeContents(text);
  // Optional for the reason every measurement in the reader is: a surface without layout (a test environment, an old
  // engine) must answer "no words here" rather than throw out of a pointer handler.
  if (typeof range.getClientRects !== "function") return false;
  // A text node can be spread over several lines, each its own box: one box inside the drag is enough.
  for (const box of range.getClientRects()) {
    if (box.width === 0 && box.height === 0) continue;
    if (box.right < drag.left) continue;
    if (box.left > drag.left + drag.width) continue;
    if (box.bottom < drag.top) continue;
    if (box.top > drag.top + drag.height) continue;
    return true;
  }
  return false;
}

/** The rectangles a highlight was drawn with, which a reflow may have moved but never invented. */
export function rectsOf(
  annotation: Annotation,
): readonly { x: number; y: number; width: number; height: number }[] {
  const anchor = annotation.anchor;
  if (anchor.kind !== "quote") return [];
  return anchor.rects ?? [];
}
