import type { Annotation } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationRow, wordsOf } from "./AnnotationRow";

/**
 * One highlight, as both lists show it.
 *
 * The row is the part that had drifted: the book's could expand and be ticked, the library's could be removed, and each was
 * missing the other's. These cases are the union, so neither list can lose a verb again without a test going red.
 */
const LONG =
  "A sentence that runs on past the width of any row, which is what the expander exists for.";

function annotation(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    sourceCardId: "book-1",
    styleId: "style-yellow",
    anchor: { kind: "quote", locator: "chapter1.xhtml", quote: LONG, prefix: "", suffix: "" },
    excerpt: LONG,
    createdAt: 1,
    ...patch,
  };
}

function draw(patch: Partial<Parameters<typeof AnnotationRow>[0]> = {}) {
  const onOpen = vi.fn();
  const onPlace = vi.fn();
  const onToggleExpand = vi.fn();
  render(
    <ul>
      <AnnotationRow
        annotation={annotation()}
        colour="#f5d90a"
        testId="row"
        expanded={false}
        onToggleExpand={onToggleExpand}
        onOpen={onOpen}
        onPlace={onPlace}
        {...patch}
      />
    </ul>,
  );
  return { onOpen, onPlace, onToggleExpand };
}

describe("a highlight row", () => {
  it("should show the words, and open the highlight when pressed", () => {
    const { onOpen } = draw();
    fireEvent.click(screen.getByTestId("row-a1"));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByTestId("row-a1")).toHaveTextContent("A sentence that runs on");
  });

  it("should show the whole passage when expanded, and hide it when not", () => {
    draw({ expanded: true });
    expect(screen.getByTestId("row-full-a1")).toHaveTextContent(LONG);
  });

  it("should offer the expander as a toggle rather than a second press target", () => {
    const { onToggleExpand } = draw();
    expect(screen.getByTestId("row-expand-a1")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByTestId("row-expand-a1"));
    expect(onToggleExpand).toHaveBeenCalled();
  });

  it("should place the highlight", () => {
    const { onPlace } = draw();
    fireEvent.click(screen.getByTestId("row-place-a1"));
    expect(onPlace).toHaveBeenCalled();
  });

  it("should offer remove only where the host can remove", () => {
    draw();
    expect(screen.queryByTestId("row-remove-a1")).toBeNull();
  });

  it("should remove the highlight where the host offers it", () => {
    const onRemove = vi.fn();
    draw({ onRemove });
    fireEvent.click(screen.getByTestId("row-remove-a1"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("should tick a row where the host places several", () => {
    const onToggle = vi.fn();
    draw({ pick: { checked: false, onToggle, label: "Pick this one" } });
    fireEvent.click(screen.getByTestId("row-pick-a1"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("should mark a note and a card without saying it twice", () => {
    draw({
      annotation: annotation({ note: "My remark.", cardId: "card-1" }),
    });
    const row = screen.getByTestId("row-a1");
    expect(row.querySelectorAll(".annotation-row-mark")).toHaveLength(2);
  });

  it("should say where the card went when the host knows", () => {
    draw({ where: <span>In the inbox</span> });
    expect(screen.getByTestId("row-a1")).toHaveTextContent("In the inbox");
  });

  it("should name a page or a passage it cannot quote", () => {
    expect(
      wordsOf(
        annotation({
          excerpt: undefined,
          anchor: { kind: "page", locator: "p", page: 3, rects: [] },
        }),
      ),
    ).toBe("Page 4");
  });
});
