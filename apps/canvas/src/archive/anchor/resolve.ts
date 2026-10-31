/**
 * Putting a highlight back on its words.
 *
 * The anchor is a quote plus the text on either side of it. Resolution tries the longest, most specific form
 * first and reports what it did, because a reader has to be told when a highlight could not be placed rather
 * than shown a mark in the wrong sentence — or worse, shown nothing.
 *
 * The cases that matter are the ones a real book produces: the same sentence twice in one chapter, a highlight
 * at the very start or end, a book that was edited after it was annotated, and a chapter that renders at a
 * different width than it did. Only the last of those is free — a quote does not care how wide the column is —
 * which is the whole reason the anchor is not an offset.
 *
 * Pure: strings in, spans out.
 */

export interface QuoteAnchor {
  readonly kind: "quote";
  /** The part of the source the quote sits in: a spine index for a book, a page for a PDF. */
  readonly locator: string;
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
}

export type AnchorSpan = { readonly start: number; readonly end: number };

/** What happened when a quote was looked for. */
export type ResolveResult =
  | {
      readonly status: "found";
      readonly start: number;
      readonly end: number;
      readonly exact: boolean;
    }
  /** More than one candidate and nothing to tell them apart: a guess would mark the wrong sentence. */
  | { readonly status: "ambiguous"; readonly candidates: number }
  /** The words are not in this chapter any more, which means the book was edited or the anchor is stale. */
  | { readonly status: "missing" };

/**
 * Find a quote in a chapter's text.
 *
 * Three passes, most specific first:
 *
 * 1. `prefix + quote + suffix`, which is unambiguous whenever the book still says what it said.
 * 2. `quote` with the prefix or the suffix beside it, which survives an edit on one side.
 * 3. `quote` alone — accepted only when it occurs **once**, because one occurrence needs no disambiguation
 *    and several need an answer this pass cannot invent.
 */
export function resolveQuote(text: string, anchor: QuoteAnchor): ResolveResult {
  const quote = anchor.quote;
  if (quote.length === 0) return { status: "missing" };

  // With no surroundings there is nothing to be exact about, and treating the bare quote as "both sides
  // matched" would take the first occurrence and skip the ambiguity check below.
  if (anchor.prefix.length > 0 || anchor.suffix.length > 0) {
    const whole = `${anchor.prefix}${quote}${anchor.suffix}`;
    const withBoth = text.indexOf(whole);
    if (withBoth !== -1) {
      const start = withBoth + anchor.prefix.length;
      return { status: "found", start, end: start + quote.length, exact: true };
    }
  }

  const total = occurrences(text, quote);
  if (total.length === 0) return { status: "missing" };

  // One side intact is enough to pick the right occurrence, and it survives an edit to the other side.
  const scored = total.map((at) => ({
    at,
    score:
      (anchor.prefix.length > 0 && text.slice(at - anchor.prefix.length, at) === anchor.prefix
        ? 1
        : 0) +
      (anchor.suffix.length > 0 &&
      text.slice(at + quote.length, at + quote.length + anchor.suffix.length) === anchor.suffix
        ? 1
        : 0),
  }));
  const best = Math.max(...scored.map((candidate) => candidate.score));
  const winners = scored.filter((candidate) => candidate.score === best);

  if (winners.length === 1 && best > 0) {
    const at = winners[0]?.at ?? 0;
    return { status: "found", start: at, end: at + quote.length, exact: false };
  }
  if (total.length === 1) {
    const at = total[0] ?? 0;
    return { status: "found", start: at, end: at + quote.length, exact: false };
  }
  return { status: "ambiguous", candidates: total.length };
}

/** Every index at which `needle` occurs in `haystack`. */
export function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (needle.length === 0) return found;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    found.push(at);
    at = haystack.indexOf(needle, at + 1);
  }
  return found;
}
