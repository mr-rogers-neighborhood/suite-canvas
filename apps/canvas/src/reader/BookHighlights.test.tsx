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

function draw(
  annotations: readonly Annotation[] = [annotation()],
  { multi = true }: { multi?: boolean } = {},
) {
  const onPlace = vi.fn();
  const onPlaceMany = vi.fn();
  render(
    <BookHighlights
      annotations={annotations}
      styles={styles}
      onOpen={vi.fn()}
      onPlace={onPlace}
      onPlaceMany={multi ? onPlaceMany : undefined}
    />,
  );
  return { onPlace, onPlaceMany };
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

describe("picking several highlights", () => {
  const three = [
    annotation({ id: "a1", excerpt: "First words." }),
    annotation({ id: "a2", excerpt: "Second words." }),
    annotation({ id: "a3", excerpt: "Third words." }),
  ];

  it("should offer no picker on a surface that cannot place a stack", () => {
    draw([annotation()], { multi: false });
    expect(screen.queryByTestId("book-highlight-pick-a1")).toBeNull();
  });

  it("should hand the picked highlights over in the order they were ticked", () => {
    const { onPlaceMany } = draw(three);

    fireEvent.click(screen.getByTestId("book-highlight-pick-a3"));
    fireEvent.click(screen.getByTestId("book-highlight-pick-a1"));
    fireEvent.click(screen.getByTestId("reader-marks-place-selection"));

    // The order is the whole point: a stack goes down in the order it was built, so the tick order is the board.
    expect(onPlaceMany).toHaveBeenCalledWith(["a3", "a1"]);
  });

  it("should show how many are picked, and clear them", () => {
    draw(three);
    fireEvent.click(screen.getByTestId("book-highlight-pick-a1"));
    fireEvent.click(screen.getByTestId("book-highlight-pick-a2"));
    expect(screen.getByTestId("reader-marks-selection")).toHaveTextContent("2 highlights picked");

    fireEvent.click(screen.getByTestId("reader-marks-clear"));
    expect(screen.queryByTestId("reader-marks-selection")).toBeNull();
  });

  it("should untick a row that is ticked again", () => {
    const { onPlaceMany } = draw(three);
    fireEvent.click(screen.getByTestId("book-highlight-pick-a1"));
    fireEvent.click(screen.getByTestId("book-highlight-pick-a1"));

    expect(screen.queryByTestId("reader-marks-selection")).toBeNull();
    expect(onPlaceMany).not.toHaveBeenCalled();
  });
});

describe("seeing a highlight's whole contents", () => {
  it("should expand a row to the whole passage, which a row's line cannot show", () => {
    const long =
      "A sentence that runs on far past the point where a single row can show it, so the whole of it has to be " +
      "available somewhere.";
    // The anchor's quote is the marked words, so it is what a full view must show: an excerpt can be shorter.
    draw([
      annotation({
        excerpt: long,
        anchor: { kind: "quote", locator: "1", quote: long, prefix: "", suffix: "" },
      }),
    ]);

    expect(screen.queryByTestId("book-highlight-full-a1")).toBeNull();
    fireEvent.click(screen.getByTestId("book-highlight-expand-a1"));

    expect(screen.getByTestId("book-highlight-full-a1")).toHaveTextContent("available somewhere");
  });

  it("should show where a broken-up highlight sends each part", () => {
    const quote = "The thing that matters here is the domain.";
    const start = quote.indexOf("the domain");
    draw([
      annotation({
        excerpt: quote,
        anchor: { kind: "quote", locator: "1", quote, prefix: "", suffix: "" },
        parts: [{ id: "p1", start, end: start + 10, target: { kind: "title" } }],
      }),
    ]);

    fireEvent.click(screen.getByTestId("book-highlight-expand-a1"));

    const full = screen.getByTestId("book-highlight-full-a1");
    // The same words the raise surface uses for a destination, so the two surfaces cannot drift.
    expect(full).toHaveTextContent("Title");
    expect(full).toHaveTextContent("the domain");
  });

  it("should offer to take the whole list away as Markdown", () => {
    const onCopyMarkdown = vi.fn();
    render(
      <BookHighlights
        annotations={[annotation()]}
        styles={styles}
        onOpen={() => {}}
        onPlace={() => {}}
        onCopyMarkdown={onCopyMarkdown}
      />,
    );
    fireEvent.click(screen.getByTestId("reader-marks-copy"));
    expect(onCopyMarkdown).toHaveBeenCalled();
  });

  it("should not offer an export a caller has not wired up", () => {
    render(
      <BookHighlights
        annotations={[annotation()]}
        styles={styles}
        onOpen={() => {}}
        onPlace={() => {}}
      />,
    );
    expect(screen.queryByTestId("reader-marks-copy")).toBeNull();
  });
});

/**
 * The verbs the row offers, which it now shares with the library's list.
 *
 * The book's panel could expand and tick but not remove, and the library's could remove but not expand: a highlight was a
 * different object depending on where it was listed. One row, so both lists offer all of it.
 */
describe("the verbs a book's highlight row offers", () => {
  it("should remove a highlight, which the library's list always could", () => {
    const onRemove = vi.fn();
    render(
      <BookHighlights
        annotations={[annotation()]}
        styles={styles}
        onOpen={() => {}}
        onPlace={() => {}}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByTestId(`book-highlight-remove-${annotation().id}`));
    expect(onRemove).toHaveBeenCalledWith(annotation().id);
  });

  it("should still offer no remove control where the host cannot remove", () => {
    render(
      <BookHighlights
        annotations={[annotation()]}
        styles={styles}
        onOpen={() => {}}
        onPlace={() => {}}
      />,
    );
    expect(screen.queryByTestId(`book-highlight-remove-${annotation().id}`)).toBeNull();
  });
});
