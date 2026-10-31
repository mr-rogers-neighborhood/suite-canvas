import type { Annotation, AnnotationStyle } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { citationOf, HighlightMenu } from "./HighlightMenu";

/**
 * A highlight's one action list.
 *
 * Two things here are worth holding still: the submenu says **Kind** (a highlight has a kind, a card has a type, and
 * the word "Type" next to the library's own Types button taught nothing), and a passage copied out of a book carries
 * where it came from, because a quote nobody can trace is the thing a citation exists to prevent.
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
      quote: "The sentence that mattered.",
      prefix: "",
      suffix: "",
    },
    excerpt: "The sentence that mattered.",
    createdAt: 1,
    ...patch,
  };
}

function draw(overrides: Partial<Parameters<typeof HighlightMenu>[0]> = {}) {
  const onPlace = vi.fn();
  render(
    <HighlightMenu
      annotation={annotation()}
      styles={styles}
      x={0}
      y={0}
      onClose={vi.fn()}
      onRaise={vi.fn()}
      onStyle={vi.fn()}
      onPlace={onPlace}
      onRemove={vi.fn()}
      source={{ title: "A Small Book", author: "Ursula K. Le Guin" }}
      {...overrides}
    />,
  );
  return { onPlace };
}

describe("a highlight's menu", () => {
  it("should call the colours kinds", () => {
    draw();
    expect(screen.getByText("Kind")).toBeInTheDocument();
    expect(screen.queryByText("Type")).toBeNull();
  });

  it("should offer both ways to copy a passage", () => {
    draw();
    expect(screen.getByText("Copy the words")).toBeInTheDocument();
    expect(screen.getByText("Copy with its source")).toBeInTheDocument();
  });

  it("should place a highlight that has no card, and open the one that has", () => {
    const { onPlace } = draw();
    fireEvent.click(screen.getByText("Place on the board"));
    expect(onPlace).toHaveBeenCalled();
  });

  it("should say a highlight already became a card", () => {
    draw({ annotation: annotation({ cardId: "card-1" }) });
    expect(screen.getByText("Open its card")).toBeInTheDocument();
    expect(screen.queryByText("Place on the board")).toBeNull();
  });
});

describe("citing a passage", () => {
  it("should quote the words and name the author and the book", () => {
    expect(citationOf(annotation(), { title: "A Small Book", author: "Ursula K. Le Guin" })).toBe(
      "\u201cThe sentence that mattered.\u201d\n\n\u2014 Ursula K. Le Guin, A Small Book",
    );
  });

  it("should name only the book when nobody is credited", () => {
    expect(citationOf(annotation(), { title: "A Small Book", author: null })).toBe(
      "\u201cThe sentence that mattered.\u201d\n\n\u2014 A Small Book",
    );
  });

  it("should still say where it is from when the anchor is not a quote", () => {
    const pdf = annotation({
      anchor: { kind: "page", locator: "12", page: 3, rects: [] },
    });
    expect(citationOf(pdf, { title: "A Paper", author: null })).toBe("\u2014 A Paper");
  });
});
