import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * The block the reader presses.
 *
 * Read has to open the *surface*, not move the camera: `focusCard` pans the board to a card, while `openCardFocus`
 * is the mode this button exists for. Getting those two the wrong way round looks exactly like a button that does
 * nothing, which is why it is asserted rather than assumed.
 */
const { bytes } = vi.hoisted(() => ({ bytes: { value: null as Uint8Array | null } }));

vi.mock("../reader/useBookBytes", () => ({
  useBookBytes: () =>
    bytes.value === null ? { status: "loading" } : { status: "ready", bytes: bytes.value },
}));

vi.mock("../reader/useBookCover", () => ({
  useBookCover: () => ({
    status: "ready",
    cover: {
      title: "A Small Book",
      creator: "Ada Lovelace",
      language: "en",
      chapters: 2,
      coverUrl: null,
    },
  }),
}));

const { BookView } = await import("./BookView");

function editorWith(cardId: string) {
  return { storage: { mention: { cardId } } } as unknown as Parameters<
    typeof BookView
  >[0]["editor"];
}

/**
 * The props a node view is given.
 *
 * Only four of them are read here, and the rest belong to ProseMirror: a test that built all of them would be
 * asserting the shape of Tiptap rather than the shape of this block.
 */
function propsFor(cardId: string): Parameters<typeof BookView>[0] {
  return {
    node: {
      attrs: {
        kind: "epub",
        id: "a".repeat(32),
        mime: "application/epub+zip",
        name: "A Book.epub",
      },
    },
    selected: false,
    editor: editorWith(cardId),
  } as unknown as Parameters<typeof BookView>[0];
}

beforeEach(() => {
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  doc.ensureBoard();
  useCanvasStore.setState({ workspace: doc });
  useUiStore.setState({ cardFocusId: null });
});

describe("the book block", () => {
  it("should draw what the book says about itself", () => {
    render(<BookView {...propsFor("card-1")} />);

    expect(screen.getByTestId("book-cover-title")).toHaveTextContent("A Small Book");
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(screen.getByTestId("book-read")).toBeEnabled();
  });

  it("should open focus mode when Read is pressed, because that is where a book reads", () => {
    render(<BookView {...propsFor("card-1")} />);

    fireEvent.click(screen.getByTestId("book-read"));
    // The mode, not the camera: `focusCard` would leave the reader looking at a card that never opened.
    expect(useUiStore.getState().cardFocusId).toBe("card-1");
  });
});
