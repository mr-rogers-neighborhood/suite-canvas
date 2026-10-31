import type { Annotation, AnnotationStyle } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHighlightDrag } from "../reader/highlightDrag";
import { LibraryAnnotationList } from "./LibraryAnnotationList";

/**
 * The library's list of highlights.
 *
 * The tab exists to answer "what have I marked", so a row has to say what it is and whether it has left the book — and
 * a press has to be distinguishable from a drag, because the drag is the promotion.
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
];

function annotation(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    sourceCardId: "book-1",
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "1",
      quote: "A passage worth keeping.",
      prefix: "",
      suffix: "",
    },
    excerpt: "A passage worth keeping.",
    createdAt: 1,
    ...patch,
  };
}

function draw(overrides: Partial<Parameters<typeof LibraryAnnotationList>[0]> = {}) {
  const onOpen = vi.fn();
  const onPlace = vi.fn();
  const onRemove = vi.fn();
  render(
    <LibraryAnnotationList
      annotations={[annotation()]}
      styles={styles}
      cardTitles={new Map()}
      onBoardCards={new Set()}
      bookTitles={new Map([["book-1", "A Small Book"]])}
      onOpen={onOpen}
      onPlace={onPlace}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { onOpen, onPlace, onRemove };
}

describe("the library's annotations", () => {
  it("should group by the book they came from and say which have not left it", () => {
    draw();
    expect(screen.getByText("A Small Book")).toBeInTheDocument();
    expect(screen.getByText("A passage worth keeping.")).toBeInTheDocument();
    expect(screen.getByText("Not a card yet")).toBeInTheDocument();
  });

  it("should name the card a highlight became, and say when it is only in the inbox", () => {
    draw({
      annotations: [annotation({ cardId: "card-1" })],
      cardTitles: new Map([["card-1", "Worth keeping"]]),
    });
    expect(screen.getByText("Worth keeping, in the inbox")).toBeInTheDocument();
    expect(screen.queryByText("Not a card yet")).toBeNull();
  });

  it("should say when a highlight's card is on the board being looked at", () => {
    draw({
      annotations: [annotation({ cardId: "card-1" })],
      cardTitles: new Map([["card-1", "Worth keeping"]]),
      onBoardCards: new Set(["card-1"]),
    });
    expect(screen.getByText("Worth keeping")).toBeInTheDocument();
    expect(screen.queryByText("Worth keeping, in the inbox")).toBeNull();
  });

  it("should place a highlight with a button, for a reader who is not dragging", () => {
    const { onPlace, onOpen } = draw();
    fireEvent.click(screen.getByTestId("library-annotation-place-a1"));
    expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("should open the passage on a press", () => {
    const { onOpen } = draw();
    fireEvent.click(screen.getByTestId("library-annotation-a1"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }));
  });

  it("should carry a highlight on a drag, through the same gesture the reader uses", () => {
    draw();
    const row = screen.getByTestId("library-annotation-a1");

    // A press that never travelled is a press, not a drag: nothing is in the reader's hand.
    fireEvent.pointerDown(row, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
    expect(useHighlightDrag.getState().carried).toBeNull();

    fireEvent.pointerDown(row, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 40 });
    expect(useHighlightDrag.getState().carried).toEqual({ annotationId: "a1" });
    // The root attribute is what stops the drag being a text selection on the way to the board.
    expect(document.documentElement.dataset.carryingHighlight).toBe("true");
    fireEvent.pointerUp(window, { clientX: 60, clientY: 40 });
    expect(useHighlightDrag.getState().carried).toBeNull();
    expect(document.documentElement.dataset.carryingHighlight).toBeUndefined();
  });

  it("should say a workspace has no highlights rather than showing an empty list", () => {
    render(
      <LibraryAnnotationList
        annotations={[]}
        styles={styles}
        cardTitles={new Map()}
        onBoardCards={new Set()}
        bookTitles={new Map()}
        onOpen={vi.fn()}
        onPlace={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId("library-annotations-empty")).toBeInTheDocument();
  });

  it("should remove a highlight without opening it", () => {
    const { onRemove, onOpen } = draw();
    fireEvent.click(screen.getByTestId("library-annotation-remove-a1"));
    expect(onRemove).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
