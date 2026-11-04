import type { OpenedBook } from "../archive/epub/open";

export function indexOfChapter(book: OpenedBook, path: string): number {
  return book.chapters.indexOf(path);
}

/** Chapters, when a book has no usable contents page: one entry per spine document. */
export function fallbackContents(
  book: OpenedBook,
): { label: string; path: string | null; fragment: null; depth: number }[] {
  return book.chapters.map((path, index) => ({
    label: `Chapter ${String(index + 1)}`,
    path,
    fragment: null,
    depth: 0,
  }));
}
