import { WorkspaceDocument } from "@suite/graph";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetBookCovers, useBookCoverCache } from "../reader/bookCoverCache";
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

vi.mock("../reader/bookCoverCache", async () => {
  const { create } = await import("zustand");
  const store = create<{
    covers: Record<string, string>;
    tried: Set<string>;
    publish: (id: string, url: string | null) => void;
  }>()((set, get) => ({
    covers: {},
    tried: new Set<string>(),
    publish: (id, url) => {
      const tried = new Set(get().tried);
      tried.add(id);
      set({
        tried,
        ...(url === null ? {} : { covers: { ...get().covers, [id]: url } }),
      });
    },
  }));
  return {
    useBookCoverCache: store,
    coverOf: (id: string) => store.getState().covers[id] ?? null,
    // A no-op by default: the cover a test wants is published by the test, so "no cover yet" and "cover arrived"
    // are two states a case can choose rather than a race it has to win.
    extractCover: vi.fn(async () => undefined),
    // Details are read from the same module, so they are stubbed at the same seam.
    bookDetails: vi.fn(async () => null),
    forgetBookCovers: () => store.setState({ covers: {}, tried: new Set() }),
  };
});

const { BookCardFace } = await import("./BookCardFace");
const { extractCover } = await import("../reader/bookCoverCache");

function seed(bookId = ID) {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setBodyNodes(card.id, [
    {
      type: "media",
      attrs: { kind: "epub", id: bookId, mime: "application/epub+zip", name: "A Book.epub" },
    },
  ]);
  useCanvasStore.setState({ workspace });
  useUiStore.setState({ cardFocusId: null });
  return { workspace, card };
}

beforeEach(() => {
  forgetBookCovers();
  vi.clearAllMocks();
});

describe("the book card on the canvas", () => {
  it("should draw the block's own name before any cover has been extracted", async () => {
    const { card } = seed();
    render(<BookCardFace card={card} />);

    expect(screen.getByTestId("book-card-title")).toHaveTextContent("A Book.epub");
    // The extractor is asked for once, off the paint, rather than the face opening a zip itself.
    await waitFor(() => expect(extractCover).toHaveBeenCalledWith(ID));
  });

  it("should draw the cover once it arrives, without the card changing shape", async () => {
    const { card } = seed();
    const { container } = render(<BookCardFace card={card} />);
    expect(container.querySelector(".book-card-cover")).toBeNull();

    // What the extractor does when it finishes, which is after this face has already painted.
    act(() => useBookCoverCache.getState().publish(ID, "blob:cover"));

    await waitFor(() => expect(container.querySelector(".book-card-cover")).not.toBeNull());
    const image = container.querySelector(".book-card-cover");
    expect(image?.getAttribute("src")).toBe("blob:cover");
    // The cover comes from the book's own bytes, so nothing about it is fetched from a third party.
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("should open focus mode on Read rather than starting a drag of the card", async () => {
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
