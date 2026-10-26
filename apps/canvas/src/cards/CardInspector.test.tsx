import type { Card } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { CardInspector, type CardInspectorProps } from "./CardInspector";
import { type CardWhere, EMPTY_CARD_LINKS } from "./CardPanel";
import { WhiteboardCardFace } from "./WhiteboardCardFace";
import { ensureWhiteboardType, readSketchDisplay } from "./whiteboard";

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

function inspector(
  card: Card,
  onEdit: () => void = callbacks.onEdit,
  overrides: Partial<CardInspectorProps> = {},
) {
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
      {...overrides}
    />
  );
}

describe("CardInspector title", () => {
  it("should own the title in its header, with no second control below it", () => {
    const onStartEditing = vi.fn();
    render(inspector(noteCard(), callbacks.onEdit, { onStartEditing }));

    // One control for one value: the drawer's header is the title row, and the
    // shared panel beneath it renders no title of its own.
    const titles = screen.getAllByTestId("card-panel-title");
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContainElement(screen.getByTestId("inspector-title-edit"));

    fireEvent.click(screen.getByTestId("inspector-title-edit"));
    expect(onStartEditing).toHaveBeenCalledWith("title");
  });

  it("should show the title as text when the reader cannot edit content", () => {
    render(inspector(noteCard(), callbacks.onEdit, { readOnly: true }));

    expect(screen.queryByTestId("inspector-title-edit")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-panel-title")).toHaveTextContent("Sketch one");
  });
});

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

describe("CardInspector place and locate", () => {
  const onBoard: CardWhere = {
    unplaced: false,
    entries: [
      {
        boardId: "board-here",
        boardName: "Board 1",
        isCurrent: true,
        isHome: true,
        sectionPath: [],
      },
    ],
  };
  const elsewhere: CardWhere = {
    unplaced: false,
    entries: [
      {
        boardId: "board-elsewhere",
        boardName: "Board 2",
        isCurrent: false,
        isHome: true,
        sectionPath: [],
      },
    ],
  };

  it("locates a card that is already on the board in front of the reader", () => {
    const onFocusCard = vi.fn();
    render(inspector(noteCard(), undefined, { where: onBoard, onFocusCard }));

    fireEvent.click(screen.getByTestId("inspector-locate"));

    expect(onFocusCard).toHaveBeenCalledWith("board-here");
    expect(screen.queryByTestId("inspector-place")).not.toBeInTheDocument();
  });

  /**
   * A card that lives on another board has nothing to locate here; Place is the
   * action that brings it onto this one.
   */
  it("places a card that is not on this board and offers no Locate", () => {
    const onPlace = vi.fn();
    render(inspector(noteCard(), undefined, { where: elsewhere, onPlace }));

    expect(screen.queryByTestId("inspector-locate")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inspector-place"));

    expect(onPlace).toHaveBeenCalledTimes(1);
  });

  it("places a card that is in the inbox", () => {
    const onPlace = vi.fn();
    render(inspector(noteCard(), undefined, { where: { unplaced: true, entries: [] }, onPlace }));

    expect(screen.queryByTestId("inspector-locate")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("inspector-place"));

    expect(onPlace).toHaveBeenCalledTimes(1);
  });

  it("offers neither action when the surface has no placement to make", () => {
    render(inspector(noteCard(), undefined, { where: { unplaced: true, entries: [] } }));

    expect(screen.queryByTestId("inspector-locate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inspector-place")).not.toBeInTheDocument();
  });
});
