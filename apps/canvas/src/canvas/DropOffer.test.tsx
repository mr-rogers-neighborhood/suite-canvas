import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { DropOffer } from "./DropOffer";

/**
 * A link released over empty canvas.
 *
 * The gesture used to be discarded, which is the one outcome a reader never wants: they
 * meant this end to point somewhere. The offer asks, and nothing exists until it is
 * answered — a mis-drop must not leave a card behind.
 */

function seed() {
  const doc = new WorkspaceDocument();
  const board = doc.createBoard({ name: "Home" });
  const from = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const connector = from.connectors[0];
  if (!connector) throw new Error("a new card has connectors");
  useCanvasStore.setState({ workspace: doc });
  useUiStore.setState({
    activeBoardId: board.id,
    canCreateContent: true,
    dropOffer: {
      x: 120,
      y: 80,
      point: { x: 400, y: 240 },
      from: { nodeId: from.id, connectorId: connector.id },
    },
  });
  return { doc, board, from, connector };
}

afterEach(() => {
  useUiStore.setState({ dropOffer: null });
});

describe("a link released over empty canvas", () => {
  it("should create the card where it was dropped, and link it back", () => {
    const { doc, board, from, connector } = seed();
    render(<DropOffer />);

    fireEvent.click(screen.getByTestId("drop-offer-card"));

    const placed = doc.listBoardPlacements(board.id).filter((entry) => entry.cardId !== from.id);
    expect(placed).toHaveLength(1);
    expect({ x: placed[0]?.x, y: placed[0]?.y }).toEqual({ x: 400, y: 240 });
    const edges = doc.listEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe(from.id);
    expect(edges[0]?.sourceConnector).toBe(connector.id);
    expect(useUiStore.getState().dropOffer).toBeNull();
  });

  it("should be able to make the card unplaced instead, for the library to hold", () => {
    const { doc, board, from } = seed();
    render(<DropOffer />);

    fireEvent.click(screen.getByTestId("drop-offer-library"));

    // The card exists and is linked, and the board gained no placement: the reader said
    // they would place it themselves.
    expect(doc.listEdges()).toHaveLength(1);
    const unplaced = doc.listBoardPlacements(board.id).filter((entry) => entry.cardId !== from.id);
    expect(unplaced).toHaveLength(0);
  });

  it("should create nothing when the reader dismisses it", () => {
    const { doc } = seed();
    render(<DropOffer />);

    fireEvent.click(screen.getByLabelText("Dismiss"));

    expect(doc.listEdges()).toHaveLength(0);
    expect(useUiStore.getState().dropOffer).toBeNull();
  });
});
