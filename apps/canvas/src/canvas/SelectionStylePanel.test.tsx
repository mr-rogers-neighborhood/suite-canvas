import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectionStylePanel } from "./SelectionStylePanel";

/**
 * The multi-selection's style editor.
 *
 * The point of the file is that it *is* the inspector's tab: the same test ids, the
 * same words, the same writes. What a selection adds is Mixed, and one undo step for
 * the whole fan-out. The bar it replaced offered surface roles and a single outline,
 * which is the drift this pins shut.
 */

function seed() {
  const doc = new WorkspaceDocument();
  const board = doc.createBoard({ name: "Home" });
  const first = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const second = doc.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
  doc.setCardStyle(second.id, { radius: 16 });
  return { doc, board, first, second };
}

describe("the style panel for a selection", () => {
  it("renders nothing for one card, which has its own inspector", () => {
    const { doc, first } = seed();
    const { container } = render(
      <SelectionStylePanel cardIds={[first.id]} canEdit workspace={doc} />,
    );

    expect(container.querySelector('[data-testid="selection-style"]')).toBeNull();
  });

  it("writes a shape to every card, keeping what each already had", () => {
    const { doc, first, second } = seed();

    render(<SelectionStylePanel cardIds={[first.id, second.id]} canEdit workspace={doc} />);
    fireEvent.click(screen.getByTestId("style-shape-pill"));

    expect(doc.getCard(first.id)?.style).toEqual({ shape: "pill" });
    expect(doc.getCard(second.id)?.style).toEqual({ shape: "pill", radius: 16 });
  });

  it("clears a value the reader sets back to default", () => {
    const { doc, first } = seed();

    render(
      <SelectionStylePanel
        cardIds={[first.id, doc.listCards()[1]?.id ?? ""]}
        canEdit
        workspace={doc}
      />,
    );
    fireEvent.click(screen.getByTestId("style-shape-pill"));
    fireEvent.click(screen.getByTestId("style-shape-default"));

    expect(doc.getCard(first.id)?.style).toBeUndefined();
  });

  it("offers the inspector's fill swatch, not a surface role", () => {
    const { doc, first } = seed();

    render(
      <SelectionStylePanel
        cardIds={[first.id, doc.listCards()[1]?.id ?? ""]}
        canEdit
        workspace={doc}
      />,
    );
    fireEvent.click(screen.getByTestId("style-swatch-rose"));

    expect(doc.getCard(first.id)?.style?.swatch).toBe("rose");
    // The old bar wrote `surface: "canvas"` and friends. A swatch is a swatch.
    expect(doc.getCard(first.id)?.style?.surface).toBeUndefined();
  });

  it("marks a value the selection disagrees about, and writes nothing for it", () => {
    const { doc, first, second } = seed();
    doc.setCardStyle(first.id, { shape: "pill" });
    doc.setCardStyle(second.id, { shape: "diamond" });

    render(<SelectionStylePanel cardIds={[first.id, second.id]} canEdit workspace={doc} />);

    const chips = screen.getByTestId("style-shapes");
    expect(chips.getAttribute("data-mixed")).toBe("true");
    // No chip claims to be the selection's value.
    expect(screen.getByTestId("style-shape-pill").getAttribute("data-checked")).toBeNull();
    expect(screen.getByTestId("style-shape-diamond").getAttribute("data-checked")).toBeNull();
  });

  it("takes the whole fan-out back in one undo", () => {
    const { doc, first, second } = seed();

    render(<SelectionStylePanel cardIds={[first.id, second.id]} canEdit workspace={doc} />);
    fireEvent.click(screen.getByTestId("style-shape-circle"));

    expect(doc.getCard(first.id)?.style?.shape).toBe("circle");
    expect(doc.getCard(second.id)?.style?.shape).toBe("circle");

    doc.undo();

    expect(doc.getCard(first.id)?.style?.shape).toBeUndefined();
    expect(doc.getCard(second.id)?.style).toEqual({ radius: 16 });
  });
});
