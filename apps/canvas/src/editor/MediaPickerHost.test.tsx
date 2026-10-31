import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { MediaPickerHost } from "./MediaPickerHost";
import { useMediaPicker } from "./mediaPicker";

/**
 * The picker offers one table and applies an answer wherever the target says it lands. These tests cover the target
 * rule rather than each kind's upload, which the media tests own: a choice is a definition, so what matters here is
 * that both surfaces reach it and that the board target makes a card.
 */
const prepareMediaFile = vi.fn();

vi.mock("./pasteImages", () => ({
  prepareMediaFile: (file: File) => prepareMediaFile(file) as Promise<unknown>,
}));

let editor: Editor | null = null;

beforeEach(() => {
  editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false })], content: "" });
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  doc.ensureBoard();
  useCanvasStore.setState({ workspace: doc });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  useMediaPicker.getState().closePicker();
  vi.clearAllMocks();
});

function openEditor(): Editor {
  const instance = editor as Editor;
  useMediaPicker.getState().openPicker({ kind: "editor", editor: instance });
  return instance;
}

function openBoard(): { boardId: string; position: { x: number; y: number } } {
  const workspace = useCanvasStore.getState().workspace;
  const boardId = workspace?.listBoards()[0]?.id ?? "board-1";
  const position = { x: 120, y: 80 };
  useMediaPicker.getState().openPicker({ kind: "board", boardId, position });
  return { boardId, position };
}

describe("the media picker", () => {
  it("should offer every kind of media in one list, a book included", () => {
    openEditor();
    render(<MediaPickerHost />);

    expect(screen.getByRole("dialog", { name: "Add media" })).toBeInTheDocument();
    for (const kind of ["image", "video", "book", "youtube", "link"]) {
      expect(screen.getByTestId(`media-choice-${kind}`)).toBeInTheDocument();
    }
  });

  it("should close once the choice is made", () => {
    openEditor();
    render(<MediaPickerHost />);

    fireEvent.click(screen.getByTestId("media-choice-link"));

    expect(useMediaPicker.getState().open).toBe(false);
    expect(useMediaPicker.getState().target).toBeNull();
  });

  it("should ask for a file rather than inserting at a caret when the target is a board", async () => {
    prepareMediaFile.mockResolvedValue({
      kind: "epub",
      id: "a".repeat(32),
      mime: "application/epub+zip",
      name: "A Book.epub",
      bytes: 2048,
    });
    const workspace = useCanvasStore.getState().workspace;
    const before = workspace?.listCards().length ?? 0;
    const { boardId, position } = openBoard();
    render(<MediaPickerHost />);

    // The native dialog is stubbed: a press is one choice, and what matters is what happens to the answer.
    const clicks: HTMLInputElement[] = [];
    const original = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = original(tag);
      if (tag === "input") clicks.push(element as HTMLInputElement);
      return element;
    });

    fireEvent.click(screen.getByTestId("media-choice-book"));
    const input = clicks.at(-1);
    expect(input?.accept).toBe("application/epub+zip,.epub");

    // Answering the dialog makes the card, at the point the reader pressed.
    const file = new File(["book"], "A Book.epub", { type: "application/epub+zip" });
    Object.defineProperty(input, "files", { value: [file] });
    input?.onchange?.(new Event("change"));

    await vi.waitFor(() => {
      expect(workspace?.listCards().length).toBe(before + 1);
    });
    const card = workspace?.listCards().at(-1);
    expect(workspace?.listPlacements().some((entry) => entry.cardId === card?.id)).toBe(true);
    const placement = workspace?.listPlacements().find((entry) => entry.cardId === card?.id);
    expect(placement?.boardId).toBe(boardId);
    expect(placement?.x).toBe(position.x);
    expect(workspace?.bodyNodes(card?.id ?? "")[0]?.attrs?.kind).toBe("epub");
  });
});
