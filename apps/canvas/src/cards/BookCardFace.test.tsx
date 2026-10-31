import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * The card a book draws on the canvas.
 *
 * Two things matter and both are about the board rather than the book: the cover arrives *after* the first paint, so
 * forty cards cannot each open a zip before anybody clicks; and Read is a press on the card that must not become a
 * drag of it.
 */
const ID = "a".repeat(32);

const loadBook = vi.fn();

vi.mock("../reader/bookMeta", async () => {
  const { create } = await import("zustand");
  const store = create<{ entries: Record<string, unknown> }>()(() => ({ entries: {} }));
  return {
    useBookMeta: store,
    loadBook: (attachmentId: string) => {
      loadBook(attachmentId);
    },
    retryBook: () => undefined,
    bookEntryOf: () => ({ status: "pending" }),
  };
});

const { BookCardFace } = await import("./BookCardFace");
const { useBookMeta } = await import("../reader/bookMeta");

function seed() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setBodyNodes(card.id, [
    {
      type: "media",
      attrs: { kind: "epub", id: ID, mime: "application/epub+zip", name: "A Book.epub" },
    },
  ]);
  useCanvasStore.setState({ workspace });
  useUiStore.setState({ cardFocusId: null });
  return { workspace, card };
}

beforeEach(() => {
  (
    useBookMeta as unknown as { setState: (state: { entries: Record<string, unknown> }) => void }
  ).setState({
    entries: {},
  });
  loadBook.mockClear();
});

describe("the book card on the canvas", () => {
  it("should draw the block's own name before the book has been read", () => {
    const { card } = seed();
    render(<BookCardFace card={card} />);

    expect(screen.getByTestId("book-card-title")).toHaveTextContent("A Book.epub");
    // The read is asked for once, off the paint, rather than the face opening a zip itself.
    expect(loadBook).toHaveBeenCalledWith(ID);
  });

  it("should draw the cover once it arrives, without the card changing shape", async () => {
    const { card } = seed();
    const { container } = render(<BookCardFace card={card} />);
    expect(container.querySelector(".book-card-cover")).toBeNull();

    // What the load does when it finishes, which is after this face has already painted.
    act(() =>
      (useBookMeta as unknown as { setState: (state: unknown) => void }).setState({
        entries: {
          [ID]: {
            status: "ready",
            meta: { title: "A Small Book", creator: "Ada Lovelace", chapters: 2 },
            coverUrl: "blob:cover",
          },
        },
      }),
    );

    await waitFor(() => expect(container.querySelector(".book-card-cover")).not.toBeNull());
    const image = container.querySelector(".book-card-cover");
    expect(image?.getAttribute("src")).toBe("blob:cover");
    // The cover comes from the book's own bytes, so nothing about it is fetched from a third party.
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.getByTestId("book-card-title")).toHaveTextContent("A Small Book");
    expect(screen.getByTestId("book-card-meta")).toHaveTextContent("Ada Lovelace · 2 chapters");
  });

  it("should open focus mode on Read rather than starting a drag of the card", () => {
    const { card } = seed();
    render(<BookCardFace card={card} />);

    const read = screen.getByTestId("book-card-read");
    // React Flow takes a press on a node as the start of a drag unless the target says otherwise.
    expect(read.className).toContain("nodrag");
    fireEvent.click(read);
    expect(useUiStore.getState().cardFocusId).toBe(card.id);
  });

  it("should show an empty tile, not a broken picture, while there is no cover", () => {
    const { card } = seed();
    render(<BookCardFace card={card} />);

    // A book whose bytes have not landed yet is a tile with a book on it: a card that narrates its own loading
    // flickers, and a broken `<img>` blames the file for the network.
    expect(document.querySelector(".book-card-cover")).toBeNull();
    expect(document.querySelector(".book-card-placeholder")).not.toBeNull();
  });
});
