import type { Card } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { WhiteboardCardFace } from "../cards/WhiteboardCardFace";
import { ensureWhiteboardType, readSketchDisplay } from "../cards/whiteboard";
import { useCanvasStore } from "../store/useCanvasStore";
import { CardInspector } from "./CardInspector";
import { type CardWhere, EMPTY_CARD_LINKS } from "./CardPanel";

const workspace = useCanvasStore.getState().workspace;
const sketchType = ensureWhiteboardType(workspace);
const where: CardWhere = { unplaced: false, entries: [] };
let boardId = "";
let sequence = 0;

beforeAll(() => {
  boardId = workspace.ensureBoard().id;
});

function sketchCard(): Card {
  sequence += 1;
  return workspace.createCard({
    id: `inspector-sketch-${sequence}`,
    typeId: sketchType.id,
    boardId,
    position: { x: 0, y: 0 },
  });
}

function noteCard(): Card {
  sequence += 1;
  return workspace.createCard({
    id: `inspector-note-${sequence}`,
    boardId,
    position: { x: 400, y: 0 },
  });
}

const callbacks = {
  onClose: () => {},
  onEdit: () => {},
  onStartEditing: () => {},
  onEditEnd: () => {},
  onSetType: () => {},
  onAddTag: () => {},
  onRemoveTag: () => {},
  onCreateTag: () => {},
  onSetProperty: () => {},
  onClearProperty: () => {},
  onOpenCardPanel: () => {},
  onManageTypes: () => {},
  onFocusCard: () => {},
  onFocusSection: () => {},
  onRemoveFromBoard: () => {},
  onFocusLink: () => {},
};

function inspector(card: Card, onEdit: () => void = callbacks.onEdit) {
  return (
    <CardInspector
      card={card}
      title="Sketch one"
      types={[sketchType]}
      tags={[]}
      boards={[]}
      fields={workspace.viewCardFields(card)}
      where={where}
      cards={[]}
      links={EMPTY_CARD_LINKS}
      linkCount={0}
      editing={null}
      cardDoc={workspace.doc}
      contentId={null}
      titleId={null}
      cursorStore={null}
      localUser={null}
      peers={[]}
      {...callbacks}
      onEdit={onEdit}
    />
  );
}

describe("CardInspector sketch controls", () => {
  it("should show the display toggle for a sketch only", () => {
    const sketch = sketchCard();
    const { rerender } = render(inspector(sketch));
    expect(screen.getByTestId("sketch-display-toggle")).toBeInTheDocument();

    rerender(inspector(noteCard()));
    expect(screen.queryByTestId("sketch-display-toggle")).not.toBeInTheDocument();
  });

  it("should flip the stored mode and the class the card paints", () => {
    const card = sketchCard();
    // The inspector and the canvas face read one stored value, so this is the
    // whole loop: toggle in the drawer, class on the board.
    const harness = (current: Card) => (
      <>
        {inspector(current)}
        <WhiteboardCardFace
          drawing={null}
          display={readSketchDisplay(workspace, current)}
          onOpen={() => {}}
        />
      </>
    );
    const { rerender } = render(harness(card));
    expect(screen.getByTestId("sketch-display-framed")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("whiteboard-card")).not.toHaveClass("whiteboard-card--seamless");

    fireEvent.click(screen.getByTestId("sketch-display-seamless"));

    const stored = workspace.getCard(card.id);
    expect(stored).toBeDefined();
    expect(readSketchDisplay(workspace, stored)).toBe("seamless");

    // The host re-renders from the committed card, exactly as a snapshot does.
    rerender(harness(stored as Card));
    expect(screen.getByTestId("sketch-display-seamless")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sketch-display-framed")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("whiteboard-card")).toHaveClass("whiteboard-card--seamless");
  });

  it("should offer Open sketch instead of editing card text", () => {
    const onEdit = vi.fn();
    render(inspector(sketchCard(), onEdit));

    expect(screen.queryByTestId("inspector-edit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inspector-open-sketch"));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("should keep the ordinary edit action for a note", () => {
    render(inspector(noteCard()));

    expect(screen.getByTestId("inspector-edit")).toBeInTheDocument();
    expect(screen.queryByTestId("inspector-open-sketch")).not.toBeInTheDocument();
  });
});
