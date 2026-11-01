/**
 * Searching inside one book.
 *
 * A reader looking for "the passage about retrieval" has the words, not the chapter, and a table of contents cannot help:
 * the answer is somewhere in a hundred thousand words. So the spine is read once, per book, and searched.
 *
 * **Sanitised before it is searched.** The words a reader sees are the sanitiser's output, so a hit has to be found in
 * the same text the chapter renders: searching the raw XHTML would match markup, and an offset into it would point at
 * the wrong place. The index is therefore built from `sanitiseChapter`, which the reader already uses for drawing.
 *
 * Pure: markup in, hits out. The reading of a book's chapters is the caller's, because that is I/O.
 */
export interface ChapterHits {
  /** The chapter's archive path, which is what a press turns to. */
  readonly path: string;
  readonly title: string | null;
  readonly hits: readonly {
    readonly before: string;
    readonly match: string;
    readonly after: string;
  }[];
}

/** How much of the words either side of a hit a row shows: enough to read, short enough for one line. */
export const SEARCH_CONTEXT_LENGTH = 48;

/** A book's whole text, indexed once so every query is a scan of strings rather than a re-read of the archive. */
export interface BookText {
  readonly chapters: readonly {
    readonly path: string;
    readonly title: string;
    readonly text: string;
  }[];
}

/** Plain text of sanitised markup, so a hit is a position in what the reader sees. */
export function textOfMarkup(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  // Blocks are words apart, as they are in the reader's own index: two paragraphs are not one run-on sentence.
  for (const block of document.querySelectorAll(
    "p, div, li, h1, h2, h3, h4, h5, h6, blockquote, tr",
  )) {
    block.append(document.createTextNode(" "));
  }
  return (document.body.textContent ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * Every occurrence of `query`, per chapter, with the words around it.
 *
 * Case-insensitive and literal: no regular expressions, because a reader typing `(` means a bracket and not a group, and
 * a search that throws on their punctuation is a search they stop using. `limit` per chapter keeps a common word from
 * returning a thousand rows nobody scrolls.
 */
export function searchBook(
  book: BookText,
  query: string,
  limit = 40,
): { readonly chapters: readonly ChapterHits[]; readonly total: number } {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return { chapters: [], total: 0 };

  const found: ChapterHits[] = [];
  let total = 0;
  for (const chapter of book.chapters) {
    const haystack = chapter.text.toLowerCase();
    const hits: { before: string; match: string; after: string }[] = [];
    let at = haystack.indexOf(needle);
    while (at !== -1 && hits.length < limit) {
      const start = at;
      const end = at + needle.length;
      hits.push({
        before: chapter.text.slice(Math.max(0, start - SEARCH_CONTEXT_LENGTH), start),
        // From the chapter's own text, not the query: the reader typed lower case and the book may not.
        match: chapter.text.slice(start, end),
        after: chapter.text.slice(end, Math.min(chapter.text.length, end + SEARCH_CONTEXT_LENGTH)),
      });
      at = haystack.indexOf(needle, at + Math.max(1, needle.length));
    }
    if (hits.length === 0) continue;
    total += hits.length;
    found.push({ path: chapter.path, title: chapter.title, hits });
  }
  return { chapters: found, total };
}

/**
 * Where a query first occurs in a chapter's flat text, or null.
 *
 * The chapter's rendered text and this index are the same reading of the same markup, so the offset is what
 * `scrollToHit` needs to find the words on the page.
 */
export function offsetOfHit(text: string, query: string): number | null {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
  return at === -1 ? null : at;
}

/**
 * A book's searchable text, read once.
 *
 * Every chapter goes through the sanitiser first, because the words on the page are what a reader is looking for and an
 * offset into raw XHTML would point at markup. A chapter that cannot be read is simply absent rather than an error: a
 * book with one broken chapter is still a book to search.
 */
export async function indexBook(
  chapters: readonly string[],
  readChapter: (path: string) => Promise<string | null>,
  sanitise: (xml: string, path: string) => { readonly html: string },
  titleOf: (path: string) => string | null = () => null,
): Promise<BookText> {
  const indexed: { path: string; title: string; text: string }[] = [];
  for (const path of chapters) {
    const xml = await readChapter(path);
    if (xml === null) continue;
    const text = textOfMarkup(sanitise(xml, path).html);
    if (text.length === 0) continue;
    indexed.push({ path, title: titleOf(path) ?? path, text });
  }
  return { chapters: indexed };
}

/**
 * Where the `occurrence`th `needle` sits in the chapter that is drawn, as a range over its own text nodes.
 *
 * The index is built from the sanitiser's markup, and the range has to be found in the same markup as the browser
 * parsed it, so both sides collapse whitespace the same way: a hit found in the index and a range found here are the
 * same words if they are counted the same way. `null` when the occurrence is not there, which is the honest answer for
 * a chapter that changed under a stale index.
 */
export function rangeOfHit(root: HTMLElement, needle: string, occurrence: number): Range | null {
  const target = needle.trim().toLowerCase();
  if (target.length === 0) return null;
  const { text, points } = textWithPoints(root);
  const haystack = text.toLowerCase();
  let at = haystack.indexOf(target);
  for (let seen = 0; at !== -1; seen += 1) {
    if (seen === occurrence) {
      const from = pointNear(points, at, 1);
      const to = pointNear(points, at + target.length - 1, -1);
      if (from === null || to === null) return null;
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset + 1);
      return range;
    }
    at = haystack.indexOf(target, at + target.length);
  }
  return null;
}

/** Scrolls a hit into view, and reports whether the chapter held it. */
export function scrollToHit(root: HTMLElement | null, needle: string, occurrence: number): boolean {
  if (root === null) return false;
  const range = rangeOfHit(root, needle, occurrence);
  if (range === null) return false;
  // Optional for the same reason every other scroll in the reader is: an engine without it must not lose the turn.
  (range.startContainer.parentElement ?? root).scrollIntoView?.({ block: "center" });
  return true;
}

/**
 * The chapter's text with each character's home in the DOM.
 *
 * Whitespace is collapsed and blocks are words apart, exactly as `textOfMarkup` does, so an offset counted here is an
 * offset counted there. A separator has no character of its own, so it is recorded as `null` and skipped when a range
 * starts on one.
 */
function textWithPoints(root: HTMLElement): {
  text: string;
  points: readonly ({ node: Text; offset: number } | null)[];
} {
  const blocks = new Set([
    "P",
    "DIV",
    "LI",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BLOCKQUOTE",
    "TR",
  ]);
  const text: string[] = [];
  const points: ({ node: Text; offset: number } | null)[] = [];
  const push = (char: string, at: { node: Text; offset: number } | null) => {
    if (char === " ") {
      const last = text.length - 1;
      if (last >= 0 && text[last] === " ") {
        // A space with no home of its own can borrow one from a space that has: same character, known place.
        if (points[last] === null && at !== null) points[last] = at;
        return;
      }
      if (last < 0) return;
    }
    text.push(char);
    points.push(at);
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (blocks.has((node as Element).tagName)) push(" ", null);
      continue;
    }
    const textNode = node as Text;
    for (let offset = 0; offset < textNode.data.length; offset += 1) {
      const char = textNode.data[offset] ?? "";
      push(/\s/u.test(char) ? " " : char, { node: textNode, offset });
    }
  }
  while (text.length > 0 && text[text.length - 1] === " ") {
    text.pop();
    points.pop();
  }
  return { text: text.join(""), points };
}

/**
 * A character's home, allowing for the separators that have none.
 *
 * A hit that begins or ends on a separator has no node to point at, so the nearest real character in `direction` is
 * used: the range then covers the words, which is what the reader wanted to see.
 */
function pointNear(
  points: readonly ({ node: Text; offset: number } | null)[],
  at: number,
  direction: 1 | -1,
): { node: Text; offset: number } | null {
  for (let index = at; index >= 0 && index < points.length; index += direction) {
    const point = points[index];
    if (point !== null && point !== undefined) return point;
  }
  return null;
}
