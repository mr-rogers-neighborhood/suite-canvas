import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { PlaceStackOutline } from "./PlaceStackOutline";
import { usePlaceStackStore } from "./placeStack";

/**
 * The stack in hand, in the order it will go down.
 *
 * A stack is placed one press at a time, so its order is the reader's last decision before the first press and there was
 * no way to see or change it. This is that view, for every way a stack can be picked up: it reads the store, so the
 * library's Place cards and a book's Place N both get it.
 */
let workspace: WorkspaceDocument;
let cardIds: string[];

beforeEach(() => {
  workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  cardIds = ["First", "Second", "Third"].map((title) => {
    const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    workspace.setTitleText(card.id, title);
    return card.id;
  });
  useCanvasStore.setState({ workspace });
  usePlaceStackStore.getState().start(cardIds);
});

afterEach(() => {
  usePlaceStackStore.getState().stop();
});

describe("the stack outline", () => {
  it("should list what is in the hand, in order", () => {
    render(<PlaceStackOutline />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("First");
    expect(rows[2]).toHaveTextContent("Third");
    expect(screen.getByTestId("place-outline")).toHaveTextContent("3 to place");
  });

  it("should draw nothing when nothing is in hand", () => {
    usePlaceStackStore.getState().stop();
    const { container } = render(<PlaceStackOutline />);
    expect(container).toBeEmptyDOMElement();
  });

  it("should move a card earlier and later", () => {
    render(<PlaceStackOutline />);
    fireEvent.click(screen.getByTestId(`place-outline-up-${cardIds[2]}`));
    expect(usePlaceStackStore.getState().queue).toEqual([cardIds[0], cardIds[2], cardIds[1]]);

    fireEvent.click(screen.getByTestId(`place-outline-down-${cardIds[0]}`));
    expect(usePlaceStackStore.getState().queue).toEqual([cardIds[2], cardIds[0], cardIds[1]]);
  });

  it("should refuse to move the first card earlier or the last one later", () => {
    render(<PlaceStackOutline />);
    expect(screen.getByTestId(`place-outline-up-${cardIds[0]}`)).toBeDisabled();
    expect(screen.getByTestId(`place-outline-down-${cardIds[2]}`)).toBeDisabled();
  });

  it("should take a card out of the hand without placing it", () => {
    render(<PlaceStackOutline />);
    fireEvent.click(screen.getByTestId(`place-outline-remove-${cardIds[1]}`));
    expect(usePlaceStackStore.getState().queue).toEqual([cardIds[0], cardIds[2]]);
  });

  it("should flip the stack with the bracket keys", () => {
    render(<PlaceStackOutline />);

    // `]` sends the top card to the back, `[` pulls the last one to the front: the pointer never leaves the board.
    fireEvent.keyDown(window, { key: "]" });
    expect(usePlaceStackStore.getState().queue).toEqual([cardIds[1], cardIds[2], cardIds[0]]);

    fireEvent.keyDown(window, { key: "[" });
    expect(usePlaceStackStore.getState().queue).toEqual([cardIds[0], cardIds[1], cardIds[2]]);
  });

  it("should leave the keys alone while the reader is typing", () => {
    render(
      <>
        <input data-testid="some-field" />
        <PlaceStackOutline />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId("some-field"), { key: "]" });
    expect(usePlaceStackStore.getState().queue).toEqual(cardIds);
  });

  it("should stop placing altogether", () => {
    render(<PlaceStackOutline />);
    fireEvent.click(screen.getByTestId("place-outline-stop"));
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });
});

describe("the placement mode inside the panel", () => {
  it("should be the same control the canvas pill draws, and change the same mode", () => {
    useUiStore.setState({ mode: "place", canManageLinks: true });
    render(<PlaceStackOutline />);

    const button = screen.getByTestId("place-outline-mode");
    expect(button).toHaveAttribute("data-mode", "place");

    fireEvent.click(button);

    // One store field, so the pill and the panel cannot disagree: there is one mode, shown twice.
    expect(useUiStore.getState().mode).toBe("thread");
  });
});
