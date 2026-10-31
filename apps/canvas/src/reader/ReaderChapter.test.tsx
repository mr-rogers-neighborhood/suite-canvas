import type { Annotation, AnnotationStyle } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReaderChapter } from "./ReaderChapter";

/**
 * Marks painted on words.
 *
 * `Range.surroundContents` throws as soon as a range partially covers an element, and the old painter swallowed that:
 * a passage over a bold word, a link or a paragraph break simply was not painted. The three cases below are the ones
 * that used to vanish, plus the report that tells a reader when something still cannot be placed.
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
];

function annotation(quote: string, patch: Partial<Annotation> = {}): Annotation {
  return {
    id: `a-${quote.slice(0, 8)}`,
    sourceCardId: "book-1",
    styleId: "style-yellow",
    anchor: { kind: "quote", locator: "1", quote, prefix: "", suffix: "" },
    excerpt: quote,
    createdAt: 1,
    ...patch,
  };
}

function draw(html: string, annotations: readonly Annotation[] = [], handlers = {}) {
  const onActivate = vi.fn();
  const onMenu = vi.fn();
  const { container } = render(
    <ReaderChapter
      html={html}
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
});
