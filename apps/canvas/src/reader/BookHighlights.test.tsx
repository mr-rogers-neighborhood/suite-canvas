import type { Annotation, AnnotationStyle } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookHighlights } from "./BookHighlights";

/**
 * A book's own list of marks.
 *
 * The count used to say "N on the board" while counting cards that might be waiting in the inbox, which is a claim the
 * panel cannot check: placements belong to the library. It counts cards now, and the filters answer the two questions a
 * reader actually has — what have I not used yet, and what did I mark as a Claim.
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
  { id: "style-blue", name: "Claim", color: "#7aa2f7", order: 1 },
];

function annotation(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    sourceCardId: "book-1",
    styleId: "style-yellow",
    anchor: { kind: "quote", locator: "1", quote: "The words.", prefix: "", suffix: "" },
    excerpt: "The words.",
    createdAt: 1,
    ...patch,
  };
}

function draw(annotations: readonly Annotation[] = [annotation()]) {
  const onPlace = vi.fn();
  render(
    <BookHighlights annotations={annotations} styles={styles} onOpen={vi.fn()} onPlace={onPlace} />,
  );
  return { onPlace };
}

describe("a book's highlights panel", () => {
  it("should count cards rather than claiming where they are", () => {
    draw([annotation(), annotation({ id: "a2", cardId: "card-1" })]);
    const count = screen.getByTestId("reader-marks-count");
    expect(count.textContent).toContain("2 highlights");
    expect(count.textContent).toContain("1 card");
    expect(count.textContent).not.toContain("on the board");
  });

  it("should filter to the ones that have no card yet", () => {
    draw([annotation(), annotation({ id: "a2", cardId: "card-1" })]);
    fireEvent.click(screen.getByTestId("reader-filter-unplaced"));
    expect(screen.getByTestId("book-highlight-a1")).toBeInTheDocument();
    expect(screen.queryByTestId("book-highlight-a2")).toBeNull();
  });

  it("should filter to one kind", () => {
    draw([annotation(), annotation({ id: "a2", styleId: "style-blue", excerpt: "A claim." })]);
    fireEvent.click(screen.getByTestId("reader-filter-style-blue"));
    expect(screen.getByTestId("book-highlight-a2")).toBeInTheDocument();
    expect(screen.queryByTestId("book-highlight-a1")).toBeNull();
  });

  it("should say so when a filter matches nothing", () => {
    draw([annotation({ cardId: "card-1" })]);
    fireEvent.click(screen.getByTestId("reader-filter-unplaced"));
    expect(screen.getByTestId("reader-marks-filtered-empty")).toBeInTheDocument();
  });

  it("should go back to everything", () => {
    draw([annotation(), annotation({ id: "a2", cardId: "card-1" })]);
    fireEvent.click(screen.getByTestId("reader-filter-unplaced"));
    fireEvent.click(screen.getByTestId("reader-filter-all"));
    expect(screen.getByTestId("book-highlight-a1")).toBeInTheDocument();
    expect(screen.getByTestId("book-highlight-a2")).toBeInTheDocument();
  });

  it("should place one from the list, for a reader who is not dragging", () => {
    const { onPlace } = draw();
    fireEvent.click(screen.getByTestId("book-highlight-place-a1"));
    expect(onPlace).toHaveBeenCalledWith("a1");
  });
});
