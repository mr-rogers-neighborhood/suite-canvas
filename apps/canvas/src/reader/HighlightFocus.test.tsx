import type { Annotation, AnnotationStyle } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HighlightFocus } from "./HighlightFocus";

/**
 * The surface a highlight is taken apart on.
 *
 * The parts are a draft: nothing is written until Done or Place, because a reader trying three ways of cutting a
 * sentence should not write three times.
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

function draw(patch: Partial<Annotation> = {}, onDone = vi.fn(), onPlace = vi.fn()) {
  render(
    <HighlightFocus
      annotation={annotation(patch)}
      styles={styles}
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
  it("should show the whole passage, because that is what the reader is deciding about", () => {
    draw();
    expect(screen.getByTestId("raise-quote")).toHaveTextContent(QUOTE);
    expect(screen.getByTestId("raise-count")).toHaveTextContent("Whole passage");
  });

  it("should say what a part can become, rather than leaving the reader to find out", () => {
    draw();
    expect(screen.getByTestId("raise-hint")).toHaveTextContent("title");
  });

  it("should list the parts a highlight already has, with the target each one points at", () => {
    const start = QUOTE.indexOf("the domain");
    draw({
      parts: [
        { id: "p1", start, end: start + "the domain".length, target: { kind: "title" } },
        { id: "p2", start: 0, end: 3, target: { kind: "field", name: "Source" } },
      ],
    });

    expect(screen.getByTestId("raise-count")).toHaveTextContent("2 parts");
    expect(screen.getByTestId("raise-target-p1")).toHaveValue("title");
    expect(screen.getByTestId("raise-target-p2")).toHaveValue("field:Source");
  });

  it("should let a target be changed without writing anything until Done", () => {
    const start = QUOTE.indexOf("the domain");
    const { onDone } = draw({
      parts: [{ id: "p1", start, end: start + "the domain".length, target: { kind: "title" } }],
    });

    fireEvent.change(screen.getByTestId("raise-target-p1"), { target: { value: "own-card" } });
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("raise-done"));
    expect(onDone).toHaveBeenCalledWith([
      expect.objectContaining({ id: "p1", target: { kind: "own-card" } }),
    ]);
  });

  it("should say how many cards Place would make", () => {
    const start = QUOTE.indexOf("what we call");
    draw({
      parts: [
        { id: "p1", start, end: 3, target: { kind: "title" } },
        { id: "p2", start, end: start + 3, target: { kind: "own-card" } },
      ],
    });
    expect(screen.getByTestId("raise-place")).toHaveTextContent("Place 2 cards");
  });

  it("should offer the properties the type already has, so a name means something", () => {
    const start = QUOTE.indexOf("the domain");
    draw({
      parts: [{ id: "p1", start, end: start + "the domain".length, target: { kind: "title" } }],
    });
    const select = screen.getByTestId("raise-target-p1");
    expect([...select.querySelectorAll("option")].map((option) => option.value)).toEqual(
      expect.arrayContaining(["title", "body", "own-card", "field:Source", "field:__new"]),
    );
  });

  it("should remove a part without touching the highlight", () => {
    const start = QUOTE.indexOf("the domain");
    const { onDone } = draw({
      parts: [{ id: "p1", start, end: start + "the domain".length, target: { kind: "title" } }],
    });

    fireEvent.click(screen.getByTestId("raise-part-remove-p1"));
    fireEvent.click(screen.getByTestId("raise-done"));
    expect(onDone).toHaveBeenCalledWith([]);
  });
});
