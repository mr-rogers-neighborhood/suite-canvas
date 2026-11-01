import type { Annotation, AnnotationStyle } from "@suite/graph";

/**
 * A book's highlights as Markdown, in the order the book is read.
 *
 * What a reader does with a hundred marks is take them somewhere else: into notes, into a draft, into a review. So the
 * export keeps the shape the reader built — the chapters in reading order, each passage quoted, its kind on the line
 * below it, and the note they wrote under that — and it does not invent anything: no numbering, no summary line, nothing
 * a paste would have to be edited out of.
 *
 * Pure: the chapters come in the order the caller read them from the book, which is the only thing this cannot know.
 */
export interface MarkdownChapter {
  /** The archive path a quote anchor's `locator` holds. */
  readonly path: string;
  readonly title: string;
}

export interface MarkdownInput {
  readonly title: string;
  readonly author: string | null;
  readonly annotations: readonly Annotation[];
  readonly styles: readonly AnnotationStyle[];
  readonly chapters: readonly MarkdownChapter[];
}

/** Every line of a quote inside a block quote, so a passage that runs over a paragraph break stays one quote. */
function quoted(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

/** The quiet line under a passage: its kind, and the note the reader wrote about it. */
function under(annotation: Annotation, styleName: string | null): string | null {
  const note = annotation.note?.trim() ?? "";
  const kind = styleName === null ? "" : `*${styleName}*`;
  if (kind.length === 0 && note.length === 0) return null;
  if (kind.length === 0) return note;
  return note.length === 0 ? kind : `${kind} — ${note}`;
}

export function highlightsMarkdown(input: MarkdownInput): string {
  const quoteOf = (annotation: Annotation) =>
    annotation.anchor.kind === "quote" ? annotation.anchor.quote : "";
  const styleName = new Map(input.styles.map((style) => [style.id, style.name]));
  const order = new Map(input.chapters.map((chapter, index) => [chapter.path, index]));

  // Grouped by chapter, because a reader's own memory of a book is spatial: "the part about spacing" is a place.
  const groups = new Map<string, Annotation[]>();
  for (const annotation of input.annotations) {
    const locator = annotation.anchor.kind === "quote" ? annotation.anchor.locator : "";
    const key = locator.trim();
    groups.set(key, [...(groups.get(key) ?? []), annotation]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    // A chapter the reader has not listed sorts last rather than first: an unknown place is not the opening chapter.
    const left = order.get(a) ?? Number.MAX_SAFE_INTEGER;
    const right = order.get(b) ?? Number.MAX_SAFE_INTEGER;
    return left === right ? a.localeCompare(b) : left - right;
  });

  const blocks: string[] = [`# ${input.title.trim() || "Untitled book"}`];
  const author = input.author?.trim() ?? "";
  if (author.length > 0) blocks.push(`*${author}*`);

  for (const key of keys) {
    const title = input.chapters.find((chapter) => chapter.path === key)?.title;
    blocks.push(title === undefined || title.trim().length === 0 ? "## Highlights" : `## ${title}`);
    for (const annotation of groups.get(key) ?? []) {
      const quote = quoteOf(annotation);
      if (quote.trim().length > 0) blocks.push(quoted(quote));
      const line = under(annotation, styleName.get(annotation.styleId) ?? null);
      if (line !== null) blocks.push(line);
    }
  }
  return `${blocks.join("\n\n")}\n`;
}
