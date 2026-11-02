import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBookStore } from "../reader/bookStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { ContinueReading } from "./ContinueReading";

/**
 * "Continue reading" is the one row in the library that is about a place rather than a thing.
 *
 * The join it makes is the part worth proving: a position is filed per attachment and a reader recognises a card, so a
 * book whose card was deleted has to drop out, and the book read most recently has to come first.
 */
const BOOK_A = "a".repeat(32);
const BOOK_B = "b".repeat(32);

let cardA = "";

function seed(workspace: WorkspaceDocument): void {
  const board = workspace.ensureBoard();
  const book = (id: string, name: string): string => {
    const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    workspace.setBodyNodes(card.id, [
      { type: "media", attrs: { kind: "epub", id, mime: "application/epub+zip", name } },
    ]);
    return card.id;
  };
  cardA = book(BOOK_A, "Make It Stick.epub");
  book(BOOK_B, "Deep Work.epub");
}

beforeEach(() => {
  window.localStorage.clear();
  useBookStore.setState({ positions: {} });
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  seed(workspace);
  useCanvasStore.setState({ workspace });
});

afterEach(() => {
  // Both stores outlive a test file: a position left here would put a strip in the next file's drawer, which is a second
  // reader's memory rather than this one's.
  window.localStorage.clear();
  useBookStore.setState({ positions: {} });
  useCanvasStore.setState({ workspace: null });
});

describe("continuing to read", () => {
  it("should offer the book that was read most recently first", () => {
    // Distinct dates, because two writes in the same millisecond are genuinely the same moment and the order would be
    // the storage's rather than the reader's.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      useBookStore.getState().remember(BOOK_A, "one.xhtml", 0, 0.25);
      vi.setSystemTime(new Date("2026-01-02T10:00:00Z"));
      useBookStore.getState().remember(BOOK_B, "two.xhtml", 0, 0.5);
    } finally {
      vi.useRealTimers();
    }

    render(<ContinueReading onOpenCard={() => {}} />);
    const rows = screen.getAllByTestId("library-continue-row");
    expect(rows[0]?.textContent).toContain("Deep Work.epub");
    expect(rows[1]?.textContent).toContain("Make It Stick.epub");
  });

  it("should say how far through the book the reader is", () => {
    useBookStore.getState().remember(BOOK_A, "one.xhtml", 0, 0.42);
    render(<ContinueReading onOpenCard={() => {}} />);
    expect(screen.getByTestId("library-continue-row").getAttribute("aria-label")).toBe(
      "Make It Stick.epub, 42% read",
    );
  });

  it("should open the card, because the card is where the book is read", () => {
    useBookStore.getState().remember(BOOK_A, "one.xhtml", 0, 0.1);
    const onOpenCard = vi.fn();
    render(<ContinueReading onOpenCard={onOpenCard} />);
    fireEvent.click(screen.getByTestId("library-continue-row"));
    expect(onOpenCard).toHaveBeenCalledWith(cardA);
  });

  it("should show nothing at all before anything has been read", () => {
    render(<ContinueReading onOpenCard={() => {}} />);
    expect(screen.queryByTestId("library-continue")).toBeNull();
  });

  it("should drop a position whose book is no longer in the workspace", () => {
    useBookStore.getState().remember("c".repeat(32), "one.xhtml", 0, 0.3);
    render(<ContinueReading onOpenCard={() => {}} />);
    expect(screen.queryByTestId("library-continue")).toBeNull();
  });

  it("should keep the list short, because a list of every book is the library itself", () => {
    useBookStore.getState().remember(BOOK_A, "one.xhtml", 0, 0.25);
    useBookStore.getState().remember(BOOK_B, "two.xhtml", 0, 0.5);
    render(<ContinueReading onOpenCard={() => {}} />);
    expect(screen.getAllByTestId("library-continue-row")).toHaveLength(2);
  });
});
