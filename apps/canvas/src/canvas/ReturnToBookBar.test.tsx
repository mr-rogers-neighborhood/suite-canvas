import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { usePlaceStackStore } from "./placeStack";
import { ReturnToBookBar } from "./ReturnToBookBar";

/**
 * The moment after the last card lands.
 *
 * A stack picked up from a book used to hand the reader back to it the instant the queue emptied, so a card that landed
 * a little to the left was already out of reach. The bar holds that moment open: the board stays usable, and the reader
 * says when they are done.
 */
let workspace: WorkspaceDocument;
let bookId: string;
let cardId: string;

beforeEach(() => {
  workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  bookId = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } }).id;
  workspace.setTitleText(bookId, "A Small Book");
  cardId = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } }).id;
  useCanvasStore.setState({ workspace });
  useUiStore.setState({ cardFocusId: null, bookPanelRequest: null });
  usePlaceStackStore.getState().start([cardId], null, { fromBook: bookId });
});

afterEach(() => {
  usePlaceStackStore.getState().stop();
});

describe("the return-to-book bar", () => {
  it("should wait until the last card is down", () => {
    render(<ReturnToBookBar />);
    // Still one in hand: the outline is what belongs on screen, not this.
    expect(screen.queryByTestId("return-to-book")).toBeNull();

    usePlaceStackStore.getState().advance();
    render(<ReturnToBookBar />);
    expect(screen.getAllByTestId("return-to-book").length).toBeGreaterThan(0);
  });

  it("should go back to the book, at the passage list", () => {
    usePlaceStackStore.getState().advance();
    render(<ReturnToBookBar />);

    fireEvent.click(screen.getByTestId("return-to-book-go"));

    expect(useUiStore.getState().cardFocusId).toBe(bookId);
    expect(useUiStore.getState().bookPanelRequest).toBe("highlights");
    // The session is over, so the focus surface is allowed to show again.
    expect(usePlaceStackStore.getState().fromBook).toBeNull();
  });

  it("should offer to keep placing, which is the same trip", () => {
    usePlaceStackStore.getState().advance();
    render(<ReturnToBookBar />);

    fireEvent.click(screen.getByTestId("return-to-book-more"));

    expect(useUiStore.getState().cardFocusId).toBe(bookId);
    expect(useUiStore.getState().bookPanelRequest).toBe("highlights");
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });

  it("should mean the same thing on Escape", () => {
    usePlaceStackStore.getState().advance();
    render(<ReturnToBookBar />);

    fireEvent.keyDown(window, { key: "Escape" });

    // A bar that is the only way out of a mode traps whoever does not see it.
    expect(useUiStore.getState().cardFocusId).toBe(bookId);
    expect(usePlaceStackStore.getState().fromBook).toBeNull();
  });

  it("should stay out of the way for a stack that came from the library", () => {
    usePlaceStackStore.getState().stop();
    usePlaceStackStore.getState().start([cardId]);
    usePlaceStackStore.getState().advance();

    const { container } = render(<ReturnToBookBar />);
    // The library's own Place cards ends at the board, which is where the reader already is.
    expect(container).toBeEmptyDOMElement();
  });
});
