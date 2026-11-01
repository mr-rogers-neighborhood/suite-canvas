import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookSearchPanel } from "./BookSearchPanel";
import type { ChapterHits } from "./bookSearch";

/**
 * Finding a place by its words.
 *
 * The count is the part worth pinning down: "3 matches in 2 chapters" is what tells a reader the search worked before
 * they scroll, and a row has to hand back the words *and* which time they appear, or two hits in one chapter both land
 * on the first one.
 */
const chapters: ChapterHits[] = [
  {
    path: "OEBPS/text/one.xhtml",
    title: "One",
    hits: [
      { before: "Spacing and ", match: "retrieval", after: ", again." },
      { before: "More ", match: "retrieval", after: " practice." },
    ],
  },
  {
    path: "OEBPS/text/two.xhtml",
    title: "Two",
    hits: [{ before: "", match: "retrieval", after: "" }],
  },
];

function renderPanel(patch: Partial<Parameters<typeof BookSearchPanel>[0]> = {}) {
  const onQuery = vi.fn();
  const onGo = vi.fn();
  render(
    <BookSearchPanel
      indexing={false}
      query="retrieval"
      onQuery={onQuery}
      chapters={chapters}
      total={3}
      onGo={onGo}
      {...patch}
    />,
  );
  return { onQuery, onGo };
}

describe("searching a book from the reader", () => {
  it("should say how many matches there are before anything is pressed", () => {
    renderPanel();
    expect(screen.getByTestId("reader-search-count")).toHaveTextContent("3 matches in 2 chapters");
  });

  it("should say so plainly when nothing matches", () => {
    renderPanel({ chapters: [], total: 0, query: "zzz" });
    expect(screen.getByTestId("reader-search-count")).toHaveTextContent("No matches.");
  });

  it("should keep the count out of the way until there is a query", () => {
    renderPanel({ query: "" });
    expect(screen.queryByTestId("reader-search-count")).toBeNull();
  });

  it("should report a single match as one match", () => {
    renderPanel({
      chapters: [chapters[1] as ChapterHits],
      total: 1,
    });
    expect(screen.getByTestId("reader-search-count")).toHaveTextContent("1 match in 1 chapter");
  });

  it("should hand back the words and which time they appear, not just the chapter", () => {
    const { onGo } = renderPanel();
    const rows = screen.getAllByTestId("reader-search-hit");
    fireEvent.click(rows[1] as HTMLElement);
    expect(onGo).toHaveBeenCalledWith("OEBPS/text/one.xhtml", "retrieval", 1);
  });

  it("should tell the reader the book is still being read while it indexes", () => {
    renderPanel({ indexing: true });
    expect(screen.getByTestId("reader-search-input")).toHaveAttribute(
      "placeholder",
      "Reading the book…",
    );
  });

  it("should pass every keystroke on, so the search is the host's to run", () => {
    const { onQuery } = renderPanel();
    fireEvent.change(screen.getByTestId("reader-search-input"), { target: { value: "spacing" } });
    expect(onQuery).toHaveBeenCalledWith("spacing");
  });
});
