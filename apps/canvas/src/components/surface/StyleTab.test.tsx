import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../../store/useCanvasStore";
import { StyleTab } from "./StyleTab";

/**
 * One editor, every surface (ADR-0051). These tests pin down the two things that
 * differ per kind — a box has four sides and a shape, a link has one stroke and
 * neither — and that every control writes through the typed document layer.
 */

beforeEach(() => {
  useCanvasStore.setState({ workspace: new WorkspaceDocument() });
});

function workspace(): WorkspaceDocument {
  return useCanvasStore.getState().workspace;
}

/** A card on a board, which is what every styled surface needs to exist first. */
function seed() {
  const doc = workspace();
  const board = doc.createBoard({ name: "Home" });
  const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const section = doc.createSection({
    boardId: board.id,
    title: "Act one",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  return { doc, board, card, section };
}

describe("StyleTab for a box", () => {
  it("offers a silhouette and four sides, and writes them to the card", () => {
    const { doc, card } = seed();
    render(<StyleTab kind="card" id={card.id} canEdit />);

    expect(screen.getByTestId("style-shapes")).toBeTruthy();
    expect(screen.getByTestId("style-side-top")).toBeTruthy();

    fireEvent.click(screen.getByTestId("style-shape-diamond"));
    expect(doc.getCard(card.id)?.style?.shape).toBe("diamond");

    fireEvent.change(screen.getByTestId("style-side-left"), { target: { value: "dashed" } });
    expect(doc.getCard(card.id)?.style?.sides?.left?.paint).toBe("dashed");

    // A side set back to solid is dropped rather than stored as a default.
    fireEvent.change(screen.getByTestId("style-side-left"), { target: { value: "solid" } });
    expect(doc.getCard(card.id)?.style?.sides?.left).toBeUndefined();
  });

  it("styles a section through the same editor", () => {
    const { doc, section } = seed();
    render(<StyleTab kind="section" id={section.id} canEdit />);

    fireEvent.click(screen.getByTestId("style-shape-pill"));

    expect(doc.getSection(section.id)?.style?.shape).toBe("pill");
  });

  it("styles a board through the same editor", () => {
    const { doc, board } = seed();
    render(<StyleTab kind="board" id={board.id} canEdit />);

    fireEvent.change(screen.getByTestId("style-surface"), { target: { value: "canvas" } });

    expect(doc.getBoard(board.id)?.style?.surface).toBe("canvas");
  });

  it("writes nothing when the reader may not edit", () => {
    const { doc, card } = seed();
    render(<StyleTab kind="card" id={card.id} canEdit={false} />);

    fireEvent.click(screen.getByTestId("style-shape-circle"));

    expect(doc.getCard(card.id)?.style).toBeUndefined();
  });
});

describe("StyleTab for a link", () => {
  it("offers one stroke instead of four sides, and no silhouette", () => {
    const { doc, board, card } = seed();
    const other = doc.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
    const edge = doc.addEdge({ boardId: board.id, source: card.id, target: other.id });
    if (!edge) throw new Error("link was not created");

    render(<StyleTab kind="edge" id={edge.id} canEdit />);

    // A line cannot wear a silhouette or hold text, so those controls are absent
    // rather than present-and-inert.
    expect(screen.queryByTestId("style-shapes")).toBeNull();
    expect(screen.queryByTestId("style-text-scale")).toBeNull();
    expect(screen.queryByTestId("style-surface")).toBeNull();
    expect(screen.getByTestId("style-line-paint")).toBeTruthy();
    expect(screen.getByTestId("style-opacity")).toBeTruthy();

    // The line style is stored on the same per-side record every surface uses, at
    // `top`: a stroke is a link's only edge.
    fireEvent.change(screen.getByTestId("style-line-paint"), { target: { value: "dashed" } });
    expect(doc.getEdge(edge.id)?.style?.sides?.top?.paint).toBe("dashed");

    fireEvent.change(screen.getByTestId("style-line-flow"), { target: { value: "reverse" } });
    expect(doc.getEdge(edge.id)?.style?.sides?.top).toEqual({ paint: "dashed", flow: "reverse" });
  });
});
