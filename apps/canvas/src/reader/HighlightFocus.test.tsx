import type { Annotation, AnnotationPartTarget, AnnotationStyle } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HighlightFocus } from "./HighlightFocus";

/**
 * The surface a highlight is taken apart on.
 *
 * Its shape is the type's: one row per slot the type fills, unfilled until words are assigned. The parts are a draft
 * until Done or Place, because a reader trying three ways of cutting a sentence should not write three times.
 */
const QUOTE = "The thing that matters here is what we call the domain.";

function annotation(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: "annotation-1",
    sourceCardId: "book-1",
    styleId: "style-yellow",
    anchor: { kind: "quote", locator: "1", quote: QUOTE, prefix: "", suffix: "" },
    excerpt: QUOTE,
    createdAt: 1,
    ...patch,
  };
}

const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
  { id: "style-green", name: "Agree", color: "#3fb950", order: 1 },
];

const SLOTS: AnnotationPartTarget[] = [{ kind: "title" }, { kind: "field", name: "Question" }];

function draw(
  patch: Partial<Annotation> = {},
  slots: AnnotationPartTarget[] = SLOTS,
  onDone = vi.fn(),
  onPlace = vi.fn(),
) {
  render(
    <HighlightFocus
      annotation={annotation(patch)}
      styles={styles}
      slots={slots}
      fieldNames={["Source"]}
      onPlace={onPlace}
      onDone={onDone}
      onStyle={vi.fn()}
      onRemove={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { onDone, onPlace };
}

describe("raising a highlight", () => {
  it("should wear the type's name and show the whole passage", () => {
    draw();
    expect(screen.getByTestId("raise-quote")).toHaveTextContent(QUOTE);
    expect(screen.getByText("Important")).toBeInTheDocument();
  });

  it("should draw one row per slot the type fills, and nothing invented", () => {
    draw();
    expect(screen.getByTestId("raise-slot-title")).toBeInTheDocument();
    expect(screen.getByTestId("raise-slot-field:Question")).toBeInTheDocument();
    expect(screen.getByTestId("raise-slot-title")).toHaveTextContent("Select words");
  });

  it("should say which slots the words already in the highlight fill", () => {
    const start = QUOTE.indexOf("the domain");
    draw({
      parts: [{ id: "p1", start, end: start + "the domain".length, target: { kind: "title" } }],
    });

    expect(screen.getByTestId("raise-slot-title")).toHaveTextContent("the domain");
    expect(screen.getByTestId("raise-slot-field:Question")).toHaveTextContent("Select words");
  });

  it("should keep a part the type did not expect, rather than hiding it", () => {
    draw({
      parts: [{ id: "p1", start: 4, end: 9, target: { kind: "field", name: "Source" } }],
    });
    // A reader's addition is theirs: it appears after the type's slots and can be cleared.
    expect(screen.getByTestId("raise-part-p1")).toHaveTextContent("Source");
    expect(screen.getByTestId("raise-part-p1-clear")).toBeInTheDocument();
  });

  it("should offer nothing invented when the type fills nothing", () => {
    draw({}, []);
    expect(screen.getByTestId("raise-hint")).toHaveTextContent("fills nothing yet");
  });

  it("should write nothing until Done", () => {
    const { onDone } = draw();
    fireEvent.click(screen.getByTestId("raise-slot-title"));
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("raise-done"));
    expect(onDone).toHaveBeenCalledWith([]);
  });

  it("should clear a slot without touching the highlight", () => {
    const start = QUOTE.indexOf("the domain");
    const { onDone } = draw({
      parts: [{ id: "p1", start, end: start + "the domain".length, target: { kind: "title" } }],
    });

    fireEvent.click(screen.getByTestId("raise-slot-title-clear"));
    fireEvent.click(screen.getByTestId("raise-done"));
    expect(onDone).toHaveBeenCalledWith([]);
  });

  it("should promise one card however many parts are mapped", () => {
    // Place used to say "Place 2 cards" when a part was marked as a card of its own. One highlight is one card now, so
    // the button says the same thing whether the passage was cut into two parts or twenty.
    draw({
      parts: [
        { id: "p1", start: 0, end: 3, target: { kind: "title" } },
        { id: "p2", start: 4, end: 9, target: { kind: "field", name: "Question" } },
      ],
    });
    expect(screen.getByTestId("raise-place")).toHaveTextContent("Place");
    expect(screen.getByTestId("raise-place").textContent).not.toContain("cards");
  });

  it("should offer the type's slots first when a part is added", () => {
    draw();
    fireEvent.click(screen.getByTestId("raise-add-part"));
    // Arming the extra row is the escape hatch: the reader selects words, then chooses a destination.
    expect(screen.getByTestId("raise-add-part")).toHaveTextContent("Select words for a new part");
  });
});
