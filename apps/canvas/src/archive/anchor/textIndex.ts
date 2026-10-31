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

/** The elements whose boundary is a word boundary: anything block-shaped in a chapter. */
const BLOCKS = new Set([
  "P",
  "DIV",
  "LI",
  "UL",
  "OL",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "FIGURE",
  "FIGCAPTION",
  "TABLE",
  "TR",
  "TD",
  "TH",
  "SECTION",
  "ARTICLE",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "BR",
]);

function blockOf(node: Node, stop: Node): Node {
  let current: Node | null = node.parentNode;
  while (current !== null && current !== stop) {
    if (current.nodeType === Node.ELEMENT_NODE && BLOCKS.has((current as Element).tagName)) {
      return current;
    }
    current = current.parentNode;
  }
  return stop;
}

/**
 * Index a subtree's text.
 *
 * Two paragraphs are two words apart, not none: the flat text separates them with one space however the markup
 * happens to be written. A book's paragraphs are often adjacent (`<p>one</p><p>two</p>`) and sometimes have the
 * newline between the tags left in, and a reader's selection across them is normalised to single spaces — so the
 * index has to agree with the selection, or an anchor taken across a paragraph break can never be found again.
 *
 * A whitespace-only node becomes no run at all: it contributes its one space to the text and nothing to paint on.
 * Offsets inside every other node are unchanged, so the map back into the DOM stays exact.
 */
export function chapterTextIndex(root: Node): TextIndex {
  const runs: TextRun[] = [];
  let text = "";
  let previousBlock: Node | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    if (value.length === 0) continue;
    const block = blockOf(node, root);
    const boundary = previousBlock !== null && block !== previousBlock;
    previousBlock = block;
    if (value.trim().length === 0) {
      if (text.length > 0 && !text.endsWith(" ")) text += " ";
      continue;
    }
    if ((boundary || value.startsWith("\n") || value.startsWith("\r")) && !text.endsWith(" ")) {
      text += " ";
    }
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
