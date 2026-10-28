import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BulkStyleBar } from "./BulkStyleBar";

/**
 * A multi-selection had no property or style edit. The bar writes the same
 * per-card style record the single-card Style tab writes, patched onto whatever
 * each card already had.
 */

function seed() {
  const doc = new WorkspaceDocument();
  const board = doc.createBoard({ name: "Home" });
  const first = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const second = doc.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
  doc.setCardStyle(second.id, { radius: 16 });
  const targets = [first.id, second.id].map((id) => {
    const card = doc.getCard(id);
    return { id, ...(card?.style ? { style: card.style } : {}) };
  });
  return { doc, first, second, targets };
}

describe("bulk style bar", () => {
  it("renders nothing for fewer than two cards", () => {
    const { doc, targets } = seed();
    const { container } = render(
      <BulkStyleBar targets={targets.slice(0, 1)} canEdit workspace={doc} />,
    );

    expect(container.querySelector('[data-testid="bulk-style-bar"]')).toBeNull();
  });

  it("writes a shape to every selected card, keeping what each already had", () => {
    const { doc, first, second, targets } = seed();

    render(<BulkStyleBar targets={targets} canEdit workspace={doc} />);
    fireEvent.click(screen.getByTestId("bulk-style-shape-pill"));

    expect(doc.getCard(first.id)?.style).toEqual({ shape: "pill" });
    expect(doc.getCard(second.id)?.style).toEqual({ shape: "pill", radius: 16 });
  });

  it("clears a value the reader sets back to default", () => {
    const { doc, first, second, targets } = seed();

    render(<BulkStyleBar targets={targets} canEdit workspace={doc} />);
    fireEvent.click(screen.getByTestId("bulk-style-shape-pill"));
    fireEvent.click(screen.getByTestId("bulk-style-shape-default"));

    expect(doc.getCard(first.id)?.style).toBeUndefined();
    expect(doc.getCard(second.id)?.style).toEqual({ radius: 16 });
  });

  it("lets the selection choose a fill colour, in the inspector's words", () => {
    const { doc, first, targets } = seed();

    render(<BulkStyleBar targets={targets} canEdit workspace={doc} />);
    // The bar reads its labels from `styles/styleOptions`, so the chip says what the
    // inspector's swatch says rather than a second vocabulary for one field.
    const chip = screen.getByTestId("bulk-style-surface-canvas");
    expect(chip).toHaveTextContent("Canvas");
    fireEvent.click(chip);

    expect(doc.getCard(first.id)?.style).toEqual({ surface: "canvas" });
  });

  it("offers the same shape words as the single-card editor", () => {
    const { doc, targets } = seed();

    render(<BulkStyleBar targets={targets} canEdit workspace={doc} />);

    for (const [value, label] of Object.entries({
      default: "Default",
      rect: "Rectangle",
      pill: "Pill",
      diamond: "Diamond",
      parallelogram: "Parallelogram",
      circle: "Circle",
      document: "Document",
      database: "Database",
      hexagon: "Hexagon",
    })) {
      expect(screen.getByTestId(`bulk-style-shape-${value}`)).toHaveTextContent(label);
    }
  });

  it("writes one outline to every edge, because a shape has one", () => {
    const { doc, first, targets } = seed();

    render(<BulkStyleBar targets={targets} canEdit workspace={doc} />);
    fireEvent.click(screen.getByTestId("bulk-style-outline-dashed"));

    expect(doc.getCard(first.id)?.style?.sides).toEqual({
      top: { paint: "dashed" },
      right: { paint: "dashed" },
      bottom: { paint: "dashed" },
      left: { paint: "dashed" },
    });
  });

  it("marks a value the selection disagrees about instead of picking one", () => {
    const doc = new WorkspaceDocument();
    const board = doc.createBoard({ name: "Home" });
    const first = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const second = doc.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
    doc.setCardStyle(first.id, { shape: "pill" });
    doc.setCardStyle(second.id, { shape: "diamond" });

    render(
      <BulkStyleBar
        targets={[
          { id: first.id, style: doc.getCard(first.id)?.style },
          { id: second.id, style: doc.getCard(second.id)?.style },
        ]}
        canEdit
        workspace={doc}
      />,
    );

    expect(screen.getByTestId("bulk-style-shape-pill")).toHaveAttribute("data-mixed", "true");
    expect(screen.getByTestId("bulk-style-shape-pill")).not.toHaveAttribute("data-checked");
  });

  it("does not write when the session cannot edit the layout", () => {
    const { doc, first, targets } = seed();

    render(<BulkStyleBar targets={targets} canEdit={false} workspace={doc} />);
    fireEvent.click(screen.getByTestId("bulk-style-shape-circle"));

    expect(doc.getCard(first.id)?.style).toBeUndefined();
    expect(screen.getByTestId("bulk-style-shape-circle")).toBeDisabled();
  });
});
