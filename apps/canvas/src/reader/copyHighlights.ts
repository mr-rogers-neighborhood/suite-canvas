import type { Annotation, AnnotationStyle } from "@suite/graph";
import type { OpenedBook } from "../archive/epub/open";
import { highlightsMarkdown } from "./bookHighlightsMarkdown";

/**
 * Copies a book's highlights as Markdown, and answers how many it copied.
 *
 * The clipboard write is here rather than in the panel because it is I/O: the panel decides what a press means, and this
 * decides what a reader takes away. A reader pastes into a document that already has a look, so nothing is added that
 * would have to be edited back out.
 */
export interface CopyHighlightsInput {
  readonly book: OpenedBook;
  /** The table of contents, so a chapter is named rather than named after its file. */
  readonly contents: readonly { readonly path: string | null; readonly label: string }[];
  readonly annotations: readonly Annotation[];
  readonly styles: readonly AnnotationStyle[];
}

export async function copyHighlights(input: CopyHighlightsInput): Promise<number> {
  const markdown = highlightsMarkdown({
    title: input.book.book.title,
    author: input.book.book.creator,
    annotations: input.annotations,
    styles: input.styles,
    chapters: input.book.chapters.map((path) => ({
      path,
      title: input.contents.find((entry) => entry.path === path)?.label ?? "",
    })),
  });
  // Optional for the reason every clipboard call in the app is: a surface without one must not lose the press.
  await navigator.clipboard?.writeText(markdown);
  return input.annotations.length;
}
