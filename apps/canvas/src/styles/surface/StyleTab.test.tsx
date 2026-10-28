import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../../store/useCanvasStore";
import { StyleTab } from "./StyleTab";

/**
 * One editor for a card, a link and a type.
 *
 * These tests pin the two things that differ per kind — a box has four sides and
 * a shape, a link has one stroke and neither — and that every control writes
 * through the typed document layer. The point of the file is that the three
 * mounts are the same component: nothing here has a scope to choose.
 */

beforeEach(() => {
  useCanvasStore.setState({ workspace: new WorkspaceDocument() });
});

function workspace(): WorkspaceDocument {
  return useCanvasStore.getState().workspace;
}

function seed() {
  const doc = workspace();
  const board = doc.createBoard({ name: "Home" });
  const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const typeId = doc.getCard(card.id)?.primaryTypeId ?? "";
  return { doc, board, card, typeId };
}

describe("StyleTab for a card", () => {
  it("writes a silhouette and a fill to the card", () => {
    const { doc, card } = seed();
    render(<StyleTab targets={[{ kind: "card", id: card.id }]} canEdit />);

    fireEvent.click(screen.getByTestId("style-shape-pill"));
    fireEvent.click(screen.getByTestId("style-swatch-blue"));

    expect(doc.getCard(card.id)?.style?.shape).toBe("pill");
    expect(doc.getCard(card.id)?.style?.swatch).toBe("blue");
  });

  it("offers a Default and a None fill beside the palette", () => {
    const { doc, card } = seed();
    render(<StyleTab targets={[{ kind: "card", id: card.id }]} canEdit />);

    fireEvent.click(screen.getByTestId("style-swatch-rose"));
    fireEvent.click(screen.getByTestId("style-swatch-default"));
    expect(doc.getCard(card.id)?.style?.swatch).toBeUndefined();

    fireEvent.click(screen.getByTestId("style-swatch-none"));
    expect(doc.getCard(card.id)?.style?.surface).toBe("none");
  });

  it("drops a side set back to solid rather than storing a default", () => {
    const { doc, card } = seed();
    render(<StyleTab targets={[{ kind: "card", id: card.id }]} canEdit />);

    fireEvent.click(screen.getByTestId("style-side-left-dashed"));
    expect(doc.getCard(card.id)?.style?.sides?.left?.paint).toBe("dashed");

    fireEvent.click(screen.getByTestId("style-side-left-solid"));
    expect(doc.getCard(card.id)?.style?.sides?.left).toBeUndefined();
  });

  it("writes nothing when the reader may not edit", () => {
    const { doc, card } = seed();
    render(<StyleTab targets={[{ kind: "card", id: card.id }]} canEdit={false} />);

    fireEvent.click(screen.getByTestId("style-shape-circle"));

    expect(doc.getCard(card.id)?.style).toBeUndefined();
  });

  it("clears the card's own style on reset", () => {
    const { doc, card } = seed();
    render(<StyleTab targets={[{ kind: "card", id: card.id }]} canEdit />);
    fireEvent.click(screen.getByTestId("style-shape-pill"));

    fireEvent.click(screen.getByTestId("style-reset"));

    expect(doc.getCard(card.id)?.style).toBeUndefined();
  });
});

describe("a card's type", () => {
  it("paints the card when the card itself names nothing", () => {
    const { doc, card, typeId } = seed();
    doc.updateType(typeId, { style: { shape: "pill" } });

    render(<StyleTab targets={[{ kind: "card", id: card.id }]} canEdit />);

    // The controls stay bound to the card's own style, so "Default" keeps meaning
    // "inherit"; one line says what it is inheriting from.
    expect(screen.getByTestId("style-inherits")).toHaveTextContent("wears");
    expect(screen.getByTestId("style-shape-default")).toHaveAttribute("data-checked", "true");
  });

  it("takes the card's style as the type default, and leaves the card alone", () => {
    const { doc, card, typeId } = seed();
    doc.setCardStyle(card.id, { shape: "diamond", swatch: "violet" });

    render(<StyleTab targets={[{ kind: "card", id: card.id }]} canEdit />);
    fireEvent.click(screen.getByTestId("style-make-default"));

    expect(doc.getType(typeId)?.style).toEqual({ shape: "diamond", swatch: "violet" });
    // Promotion states the default; it does not strip the card that asked for it.
    expect(doc.getCard(card.id)?.style).toEqual({ shape: "diamond", swatch: "violet" });
  });

  it("is not offered until the card has a style of its own", () => {
    const { card } = seed();
    render(<StyleTab targets={[{ kind: "card", id: card.id }]} canEdit />);

    expect(screen.getByTestId("style-make-default")).toBeDisabled();
  });
});

describe("StyleTab for a type", () => {
  it("writes the type's own style, which every card of it inherits", () => {
    const { doc, typeId } = seed();
    render(<StyleTab targets={[{ kind: "type", id: typeId }]} canEdit />);

    fireEvent.click(screen.getByTestId("style-shape-diamond"));

    expect(doc.getType(typeId)?.style?.shape).toBe("diamond");
  });

  it("offers no promotion, because the type is where the default already lives", () => {
    const { typeId } = seed();
    render(<StyleTab targets={[{ kind: "type", id: typeId }]} canEdit />);

    expect(screen.queryByTestId("style-make-default")).toBeNull();
  });
});

describe("StyleTab for a link", () => {
  it("offers one stroke instead of four sides, and no silhouette", () => {
    const { doc, board, card } = seed();
    const to = doc.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
    const edge = doc.addEdge({
      boardId: board.id,
      source: card.id,
      target: to.id,
      kind: "relates-to",
    });
    if (!edge) throw new Error("a link between two placed cards is drawable");

    render(<StyleTab targets={[{ kind: "edge", id: edge.id }]} canEdit />);

    expect(screen.queryByTestId("style-shapes")).toBeNull();
    // A link has one stroke, so the four per-side rows are not there; the line
    // style row is.
    expect(screen.queryByTestId("style-side-top")).toBeNull();
    expect(screen.getByTestId("style-line-paint")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("style-line-paint-dotted"));

    expect(doc.getEdge(edge.id)?.style?.sides?.top?.paint).toBe("dotted");
  });
});
