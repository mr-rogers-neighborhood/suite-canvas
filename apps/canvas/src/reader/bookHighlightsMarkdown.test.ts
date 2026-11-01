import type { Annotation, AnnotationStyle } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { highlightsMarkdown, type MarkdownChapter } from "./bookHighlightsMarkdown";

/**
 * Taking a book's highlights somewhere else.
 *
 * The shape is the point: chapters in reading order, each passage quoted, kind and note under it. A paste that has to be
 * edited before it can be used is a paste a reader stops doing.
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
  { id: "style-blue", name: "Claim", color: "#7aa2f7", order: 1 },
];

const chapters: MarkdownChapter[] = [
  { path: "OEBPS/text/one.xhtml", title: "One" },
  { path: "OEBPS/text/two.xhtml", title: "Two" },
];

function annotation(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    sourceCardId: "book-1",
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "OEBPS/text/one.xhtml",
      quote: "Retrieval is the effort of recall.",
      prefix: "",
      suffix: "",
    },
    excerpt: "Retrieval is the effort of recall.",
    createdAt: 1,
    ...patch,
  };
}

describe("highlights as Markdown", () => {
  it("should open with the book and its author", () => {
    const markdown = highlightsMarkdown({
      title: "Make It Stick",
      author: "Brown",
      annotations: [annotation()],
      styles,
      chapters,
    });
    expect(markdown.startsWith("# Make It Stick\n\n*Brown*\n")).toBe(true);
  });

  it("should put a chapter's passages under the chapter, in reading order", () => {
    const markdown = highlightsMarkdown({
      title: "Book",
      author: null,
      // Given back to front: the book's own order is what decides.
      annotations: [
        annotation({
          id: "a2",
          anchor: {
            kind: "quote",
            locator: "OEBPS/text/two.xhtml",
            quote: "Second chapter words.",
            prefix: "",
            suffix: "",
          },
        }),
        annotation(),
      ],
      styles,
      chapters,
    });
    expect(markdown.indexOf("## One")).toBeLessThan(markdown.indexOf("## Two"));
    expect(markdown.indexOf("## Two")).toBeLessThan(markdown.indexOf("Second chapter words."));
  });

  it("should quote the passage and name its kind underneath", () => {
    const markdown = highlightsMarkdown({
      title: "Book",
      author: null,
      annotations: [annotation()],
      styles,
      chapters,
    });
    expect(markdown).toContain("> Retrieval is the effort of recall.\n\n*Important*");
  });

  it("should keep a passage that runs over two paragraphs inside one quote", () => {
    const markdown = highlightsMarkdown({
      title: "Book",
      author: null,
      annotations: [
        annotation({
          anchor: {
            kind: "quote",
            locator: "OEBPS/text/one.xhtml",
            quote: "First paragraph.\nSecond paragraph.",
            prefix: "",
            suffix: "",
          },
        }),
      ],
      styles,
      chapters,
    });
    expect(markdown).toContain("> First paragraph.\n> Second paragraph.");
  });

  it("should carry the note a reader wrote, beside the kind that marked it", () => {
    const markdown = highlightsMarkdown({
      title: "Book",
      author: null,
      annotations: [annotation({ styleId: "style-blue", note: "This is the whole argument." })],
      styles,
      chapters,
    });
    expect(markdown).toContain("*Claim* — This is the whole argument.");
  });

  it("should say nothing under a passage with no kind and no note", () => {
    const markdown = highlightsMarkdown({
      title: "Book",
      author: null,
      annotations: [annotation({ styleId: "style-gone" })],
      styles,
      chapters,
    });
    expect(markdown).not.toContain("\n\n\n");
    expect(markdown.trim().endsWith("> Retrieval is the effort of recall.")).toBe(true);
  });

  it("should head a chapter it cannot name as highlights rather than as a file path", () => {
    const markdown = highlightsMarkdown({
      title: "Book",
      author: null,
      annotations: [
        annotation({
          anchor: {
            kind: "quote",
            locator: "OEBPS/text/lost.xhtml",
            quote: "Nowhere.",
            prefix: "",
            suffix: "",
          },
        }),
      ],
      styles,
      chapters,
    });
    expect(markdown).toContain("## Highlights");
    expect(markdown).not.toContain("lost.xhtml");
  });

  it("should end with a newline, so a paste does not run into what follows it", () => {
    const markdown = highlightsMarkdown({
      title: "Book",
      author: null,
      annotations: [annotation()],
      styles,
      chapters,
    });
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
