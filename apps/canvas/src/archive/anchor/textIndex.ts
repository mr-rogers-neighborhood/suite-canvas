/**
 * A chapter's flat text, and the map back into its nodes.
 *
 * A highlight is stored as the words a reader selected, never as an offset: reflow makes an offset wrong the
 * moment the window changes, and the same book renders differently on every screen. To put a highlight back we
 * need the flat text to search, and — once a match is found — the DOM range the match covers. That is what this
 * index is: the text, plus where each text node starts in it.
 *
 * Pure, and DOM-shaped only through the nodes it is given, so the resolver can be tested without a renderer.
 */

/** One run of text: a node, and the offset in the flat text where it begins. */
export interface TextRun {
  readonly node: Node;
  readonly start: number;
  readonly end: number;
}

export interface TextIndex {
  /** Every text node's words, in document order, joined. */
  readonly text: string;
  readonly runs: readonly TextRun[];
}

/**
 * Index a subtree's text.
 *
 * Blocks are assumed to be separated by whitespace that is already in the markup, because a book's markup
 * says so: a chapter's paragraphs each end with a newline or are separated by an element boundary the
 * renderer puts a space at. Inserting separators here instead would make the stored quote and the rendered
 * text disagree about where a space is, which is the one thing the search cannot tolerate.
 */
export function chapterTextIndex(root: Node): TextIndex {
  const runs: TextRun[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    if (value.length === 0) continue;
    runs.push({ node, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { text, runs };
}

/** The DOM range one span of the flat text covers, or null when the index does not reach it. */
export function rangeOf(index: TextIndex, start: number, end: number): Range | null {
  if (start < 0 || end > index.text.length || end <= start) return null;
  const from = runAt(index, start);
  const to = runAt(index, end - 1);
  if (from === undefined || to === undefined) return null;

  const range = document.createRange();
  range.setStart(from.node, start - from.start);
  range.setEnd(to.node, end - to.start);
  return range;
}

/** The run containing one offset, or the furthest run that starts at it. */
function runAt(index: TextIndex, offset: number): TextRun | undefined {
  let low = 0;
  let high = index.runs.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const run = index.runs[middle];
    if (run === undefined) return undefined;
    if (offset < run.start) high = middle - 1;
    else if (offset >= run.end) low = middle + 1;
    else return run;
  }
  return undefined;
}

/**
 * The text around a span, which is what tells two occurrences of one sentence apart.
 *
 * Long enough to be distinctive and short enough that a paragraph added beside a highlight does not break it:
 * the ratio the Hypothesis client settled on, and for the same reason.
 */
export const PREFIX_LENGTH = 32;
export const SUFFIX_LENGTH = 32;

export function surroundings(
  text: string,
  start: number,
  end: number,
): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, start - PREFIX_LENGTH), start),
    suffix: text.slice(end, Math.min(text.length, end + SUFFIX_LENGTH)),
  };
}
