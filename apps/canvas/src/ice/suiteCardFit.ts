/**
 * Fitting a card's writing into its box — the third reading of a resize.
 *
 * `suiteCardScale.ts` couples a card's box to its type size, and that
 * decoupling has one failure mode: a box that is too small for the type it
 * carries cuts the writing off. It is not a rendering bug; it is the arithmetic
 * of two independent numbers. On an infinite canvas we can fix it the other way
 * round from a web page: the box is free and the writing is the constraint, so
 * instead of shrinking type into a fixed frame, a card **steps its rung down
 * until the writing fits, and never renders a box smaller than the writing
 * needs**.
 *
 * That is what makes fractal presets possible. A recursive layout multiplies a
 * card's size by a step (√2) per level; without fitting, every deeper level
 * scrunches. With it, the same layout is legible at every depth because a card
 * that got smaller also stepped down a rung.
 *
 * All of it is arithmetic on a text estimate — no DOM measurement, no font
 * loading, so the projection (which runs before anything is painted) can use
 * exactly the same function as the gesture does.
 */

import {
  CARD_BASE_EXTENT,
  type CardTypeScale,
  clampCardTypeScale,
  SUITE_TYPE_LADDER,
  scaleForExtent,
} from "./suiteCardScale";

/**
 * How a card's writing measures. `size` and `pad` are ICE's own law at rung 1
 * (`SUITE_CARD_HAND` in `suitePen.ts`); `advance` is the average glyph width as
 * a fraction of the em for the proportional face the card uses.
 *
 * The advance is deliberately slightly generous: over-estimating a line's width
 * costs a box a few units taller, where under-estimating costs a clipped card.
 */
export const CARD_TEXT_METRICS = {
  size: 13,
  lineHeight: 1.45,
  pad: 14,
  advance: 0.54,
} as const;

/** A box in world units. */
export interface FitExtent {
  readonly width: number;
  readonly height: number;
}

/** What the writing needs at one rung. */
export interface CardTextFit {
  /** Rendered lines at that rung. */
  readonly lines: number;
  /** Height the lines need, including the card's padding. */
  readonly height: number;
  /** Width the widest single word needs, including padding. */
  readonly width: number;
  /** True when the whole flow fits the box it was measured against. */
  readonly fits: boolean;
}

/** Both halves of the answer, so a caller cannot take one without the other. */
export interface CardFit {
  readonly rung: CardTypeScale;
  /** The box to use: the one asked for, unless the writing needs more. */
  readonly extent: FitExtent;
}

function words(text: string): string[][] {
  // A blank line is a paragraph break, which costs a line of its own — that is
  // how the projection writes a title above a body.
  return text.split("\n").map((paragraph) => paragraph.split(/\s+/).filter(Boolean));
}

/**
 * The line count a text takes in a given inner width, by greedy wrapping.
 *
 * A word longer than the line breaks across lines rather than overflowing;
 * that is what keeps a URL from pushing a card's box wider than the user drew it.
 */
export function wrappedLineCount(text: string, innerWidth: number, em: number): number {
  const perChar = Math.max(0.001, em * CARD_TEXT_METRICS.advance);
  const columns = Math.max(1, Math.floor(innerWidth / perChar));
  let lines = 0;
  for (const paragraph of words(text)) {
    if (paragraph.length === 0) {
      // An empty line still occupies one.
      lines += 1;
      continue;
    }
    let used = 0;
    let count = 1;
    for (const word of paragraph) {
      const length = word.length;
      if (length > columns) {
        // The word itself breaks: fill the current line, then whole lines.
        if (used > 0) count += 1;
        count += Math.floor((length - 1) / columns);
        used = length % columns;
        if (used === 0) {
          used = columns;
        }
        continue;
      }
      const needed = used === 0 ? length : used + 1 + length;
      if (needed <= columns) {
        used = needed;
      } else {
        count += 1;
        used = length;
      }
    }
    lines += count;
  }
  return lines;
}

/** The widest single word at a rung, which is the narrowest a card may be. */
function widestWord(text: string, em: number): number {
  let widest = 0;
  for (const paragraph of words(text)) {
    for (const word of paragraph) widest = Math.max(widest, word.length);
  }
  return widest * em * CARD_TEXT_METRICS.advance;
}

/** What `text` needs at `rung` inside `extent`. */
export function cardTextFit(text: string, extent: FitExtent, rung: number): CardTextFit {
  const scale = Number.isFinite(rung) && rung > 0 ? rung : 1;
  const em = CARD_TEXT_METRICS.size * scale;
  const pad = CARD_TEXT_METRICS.pad * scale;
  const innerWidth = Math.max(0, extent.width - pad * 2);
  const lines = text.length === 0 ? 0 : wrappedLineCount(text, innerWidth, em);
  const height = lines * em * CARD_TEXT_METRICS.lineHeight + pad * 2;
  const width = widestWord(text, em) + pad * 2;
  return {
    lines,
    height,
    width,
    fits: height <= extent.height + 0.5 && width <= extent.width + 0.5,
  };
}

/**
 * The rung a card should wear and the box it needs.
 *
 * The box proposes and the writing vetoes, in that order: the starting rung is
 * the one the box's own proportions imply (`scaleForExtent`, the same function
 * the projection uses), and the writing may only ever step it *down*. A box that
 * is merely small is not a problem — a box that is small *for its type* is, and
 * that is what the veto removes.
 *
 * Two guarantees, both tested:
 * - the rung is never larger than what the box can hold, so a card is never
 *   drawn with writing that runs off it;
 * - the returned box is never *smaller* than the first argument, so fitting
 *   cannot silently undo a drag — it only ever grows a box that is too short.
 */
export function cardFit(text: string, extent: FitExtent): CardFit {
  const floor = clampCardTypeScale(SUITE_TYPE_LADDER[0]);
  const proposed = clampCardTypeScale(scaleForExtent(extent));
  const ladder = [...SUITE_TYPE_LADDER]
    .filter((rung) => rung <= proposed)
    .sort((first, second) => second - first);
  for (const rung of ladder) {
    if (cardTextFit(text, extent, rung).fits) return { rung, extent };
  }
  // Nothing down to the floor fits: keep the smallest type and grow the box
  // until the writing does, which is the one case fitting may change a size.
  const needed = cardTextFit(text, extent, floor);
  return {
    rung: floor,
    extent: {
      width: Math.max(extent.width, Math.ceil(needed.width)),
      height: Math.max(extent.height, Math.ceil(needed.height)),
    },
  };
}

/** The extent a card is born with, so a caller can fit a new card too. */
export const CARD_NATURAL_EXTENT: FitExtent = {
  width: CARD_BASE_EXTENT.width,
  height: CARD_BASE_EXTENT.height,
};
