import type { Annotation, AnnotationStyle } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReaderChapter } from "./ReaderChapter";

/**
 * Marks painted on words.
 *
 * `Range.surroundContents` throws as soon as a range partially covers an element, and the old painter swallowed that:
 * a passage over a bold word, a link or a paragraph break simply was not painted. The cases below are the ones that
 * used to vanish, plus the report that tells a reader when something still cannot be placed.
 *
 * The last three are the painter's own two regressions: a mark that survived a chapter change (the effect did not
 * depend on the markup, so the next chapter had no marks at all) and a mark that nested inside itself on every
 * repaint (the painter wrapped without unwrapping first).
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
];

/** The chapter every test starts on, and the one a highlight records unless it says otherwise. */
const CHAPTER = "OEBPS/text/chapter1.xhtml";

function annotation(quote: string, patch: Partial<Annotation> = {}): Annotation {
  return {
    id: `a-${quote.slice(0, 8)}`,
    sourceCardId: "book-1",
    styleId: "style-yellow",
    anchor: { kind: "quote", locator: CHAPTER, quote, prefix: "", suffix: "" },
    excerpt: quote,
    createdAt: 1,
    ...patch,
  };
}

function draw(
  html: string,
  annotations: readonly Annotation[] = [],
  handlers = {},
  locator = CHAPTER,
) {
  const onActivate = vi.fn();
  const onMenu = vi.fn();
  const { container } = render(
    <ReaderChapter
      html={html}
      locator={locator}
      annotations={annotations}
      styles={styles}
      onSelect={vi.fn()}
      onCarry={vi.fn()}
      onActivate={onActivate}
      onMenu={onMenu}
      {...handlers}
    />,
  );
  return { container, onActivate, onMenu };
}

describe("painting a chapter", () => {
  it("should paint a passage that starts mid-sentence", () => {
    const { container } = draw("<p>The first sentence of the book.</p>", [
      annotation("first sentence"),
    ]);
    expect(container.querySelectorAll("mark.reader-highlight")).toHaveLength(1);
    expect(container.querySelector("mark")?.textContent).toBe("first sentence");
  });

  it("should paint a passage that covers a bold word", () => {
    // The case that used to disappear: `surroundContents` refuses a range that partly covers an element.
    const { container } = draw("<p>The <em>first</em> sentence of the book.</p>", [
      annotation("The first sentence"),
    ]);
    const marks = container.querySelectorAll("mark.reader-highlight");
    expect(marks.length).toBeGreaterThan(0);
    // Every segment carries the same id, so the passage reads as one mark even when it is three wrappers.
    const ids = new Set([...marks].map((mark) => mark.getAttribute("data-annotation-id")));
    expect(ids.size).toBe(1);
    expect([...marks].map((mark) => mark.textContent).join("")).toContain("first");
  });

  it("should paint a passage that spans two paragraphs", () => {
    const { container } = draw(
      "<p>The first sentence of the book.</p><p>A second paragraph follows it.</p>",
      [annotation("book. A second paragraph")],
    );
    const marks = container.querySelectorAll("mark.reader-highlight");
    expect(marks.length).toBe(2);
    expect(marks[0]?.textContent).toContain("book.");
    expect(marks[1]?.textContent).toContain("A second paragraph");
  });

  it("should say so when a passage is not in this chapter", async () => {
    draw("<p>Something else entirely.</p>", [annotation("a sentence that is not here")]);
    await waitFor(() => expect(screen.getByTestId("reader-unplaced")).toBeInTheDocument());
    expect(screen.getByTestId("reader-unplaced").textContent).toContain("One highlight");
  });

  it("should say nothing when every highlight is on the page", () => {
    draw("<p>The first sentence of the book.</p>", [annotation("first sentence")]);
    expect(screen.queryByTestId("reader-unplaced")).toBeNull();
  });

  it("should raise a mark from the keyboard", () => {
    const { container, onActivate } = draw("<p>The first sentence of the book.</p>", [
      annotation("first sentence"),
    ]);
    const mark = container.querySelector("mark.reader-highlight");
    if (mark === null) throw new Error("no mark");
    expect(mark).toHaveAttribute("tabindex", "0");
    expect(mark).toHaveAttribute("role", "button");

    fireEvent.keyDown(mark, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith(expect.stringContaining("a-first"));
  });

  it("should open a mark's menu from the keyboard", () => {
    const { container, onMenu } = draw("<p>The first sentence of the book.</p>", [
      annotation("first sentence"),
    ]);
    const mark = container.querySelector("mark.reader-highlight");
    if (mark === null) throw new Error("no mark");
    fireEvent.keyDown(mark, { key: "ContextMenu" });
    expect(onMenu).toHaveBeenCalled();

    fireEvent.keyDown(mark, { key: "F10", shiftKey: true });
    expect(onMenu).toHaveBeenCalledTimes(2);
  });

  it("should paint the next chapter's marks when the chapter changes", () => {
    // The regression: the effect did not depend on the markup, so turning a page left every highlight in the book
    // unpainted until something else happened to re-render the surface.
    const marks = [
      annotation("first chapter words"),
      {
        ...annotation("second chapter words"),
        id: "a-second",
        anchor: {
          kind: "quote" as const,
          locator: "OEBPS/text/chapter2.xhtml",
          quote: "second chapter words",
          prefix: "",
          suffix: "",
        },
      },
    ];
    const { container, rerender } = render(
      <ReaderChapter
        html="<p>first chapter words.</p>"
        locator="OEBPS/text/chapter1.xhtml"
        annotations={marks}
        styles={styles}
        onSelect={vi.fn()}
        onCarry={vi.fn()}
        onActivate={vi.fn()}
        onMenu={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("mark.reader-highlight")).toHaveLength(1);

    rerender(
      <ReaderChapter
        html="<p>second chapter words.</p>"
        locator="OEBPS/text/chapter2.xhtml"
        annotations={marks}
        styles={styles}
        onSelect={vi.fn()}
        onCarry={vi.fn()}
        onActivate={vi.fn()}
        onMenu={vi.fn()}
      />,
    );

    expect(container.querySelectorAll("mark.reader-highlight")).toHaveLength(1);
    expect(container.querySelector("mark")?.textContent).toBe("second chapter words");
  });

  it("should leave one mark per segment however often the palette changes", () => {
    // The regression: the painter wrapped without unwrapping, so every restyle nested a mark inside the previous one
    // and the words beneath it kept the old colour.
    const blue: AnnotationStyle = {
      id: "style-blue",
      name: "Reference",
      color: "#4c8dff",
      order: 1,
    };
    const props = {
      html: "<p>The first sentence of the book.</p>",
      locator: CHAPTER,
      annotations: [annotation("first sentence")],
      onSelect: vi.fn(),
      onCarry: vi.fn(),
      onActivate: vi.fn(),
      onMenu: vi.fn(),
    };
    const { container, rerender } = render(<ReaderChapter {...props} styles={[blue]} />);
    expect(container.querySelectorAll("mark")).toHaveLength(1);

    rerender(<ReaderChapter {...props} styles={[blue, styles[0] as AnnotationStyle]} />);
    rerender(<ReaderChapter {...props} styles={[styles[0] as AnnotationStyle, blue]} />);

    expect(container.querySelectorAll("mark")).toHaveLength(1);
    expect(container.querySelectorAll("mark mark")).toHaveLength(0);
  });

  it("should not paint or report a highlight that belongs to another chapter", () => {
    draw("<p>The first sentence of the book.</p>", [
      annotation("first sentence"),
      {
        ...annotation("first sentence"),
        id: "a-elsewhere",
        anchor: {
          kind: "quote",
          locator: "OEBPS/text/chapter9.xhtml",
          quote: "first sentence",
          prefix: "",
          suffix: "",
        },
      },
    ]);

    // One mark for this chapter's highlight, and nothing said about somebody else's page.
    expect(document.querySelectorAll("mark.reader-highlight")).toHaveLength(1);
    expect(screen.queryByTestId("reader-unplaced")).toBeNull();
  });

  it("should paint a legacy locator that resolves without reporting it as lost", () => {
    // Schema 5 recorded the chapter's character count. Those records cannot be placed in a chapter, so they are
    // tolerated where they resolve and never counted — there is no honest answer to "which chapter lost it".
    draw("<p>The first sentence of the book.</p>", [
      {
        ...annotation("first sentence"),
        anchor: {
          kind: "quote",
          locator: "143",
          quote: "first sentence",
          prefix: "",
          suffix: "",
        },
      },
      {
        ...annotation("a passage the book never had"),
        id: "a-legacy-gone",
        anchor: {
          kind: "quote",
          locator: "143",
          quote: "a passage the book never had",
          prefix: "",
          suffix: "",
        },
      },
    ]);

    expect(document.querySelectorAll("mark.reader-highlight")).toHaveLength(1);
    expect(screen.queryByTestId("reader-unplaced")).toBeNull();
  });
});
