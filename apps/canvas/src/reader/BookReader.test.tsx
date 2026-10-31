import { WorkspaceDocument } from "@suite/graph";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { BookReader } from "./BookReader";
import { useBookStore } from "./bookStore";

/**
 * The reader, over a book assembled here.
 *
 * The bytes go in through the local-attachment path rather than the relay, which is the path a freshly dropped
 * book takes anyway: the reader reads this browser's copy first, so a book opens before it has uploaded.
 */
const { bytes } = vi.hoisted(() => ({
  bytes: { value: new Uint8Array() as Uint8Array<ArrayBuffer> },
}));

vi.mock("./useBookBytes", () => ({
  useBookBytes: () => ({ status: "ready", bytes: bytes.value }),
}));

vi.mock("../editor/attachmentNode", () => ({
  ATTACHMENT_ID_PATTERN: /^[0-9a-f]{32}$/u,
  attachmentUrl: (id: string) => `/api/attachments/${id}`,
  readLocalAttachment: async () => null,
}));

async function bookBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const { bookEntries, zipOf } = await import("../archive/epub/fixture");
  return zipOf(bookEntries()) as Promise<Uint8Array<ArrayBuffer>>;
}

let bookCardId = "";

beforeEach(async () => {
  // A reading position is remembered in `localStorage`, so one test turning a page must not move the next
  // test's book: that is the behaviour under test, and it has to be isolated like any other.
  window.localStorage.clear();
  useBookStore.setState({ positions: {} });
  const doc = new WorkspaceDocument();
  doc.ensureDefaultTypes();
  const board = doc.ensureBoard();
  bookCardId = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } }).id;
  useCanvasStore.setState({ workspace: doc });
  bytes.value = await bookBytes();
});

describe("the book reader", () => {
  it("should open on the book's title and its first chapter", async () => {
    render(<BookReader attachmentId={"a".repeat(32)} mime="application/epub+zip" name="book" />);

    await waitFor(() => expect(screen.getByTestId("book-reader")).toBeInTheDocument());
    expect(screen.getByText("A Small Book")).toBeInTheDocument();
    // The chapter is read on demand, so it arrives a tick after the package does.
    await waitFor(() =>
      expect(screen.getByTestId("reader-body").textContent).toContain(
        "The first sentence of the book.",
      ),
    );
  });

  it("should draw the contents the book declares, and turn to another chapter", async () => {
    render(<BookReader attachmentId={"a".repeat(32)} mime="application/epub+zip" name="book" />);
    await waitFor(() => expect(screen.getByTestId("reader-contents-toggle")).toBeInTheDocument());

    screen.getByTestId("reader-contents-toggle").click();
    await waitFor(() => expect(screen.getByTestId("reader-contents")).toBeInTheDocument());
    expect(screen.getByText("Two, and a place inside it")).toBeInTheDocument();

    screen.getByTestId("reader-next").click();
    await waitFor(() =>
      expect(screen.getByText(/The same sentence appears twice/)).toBeInTheDocument(),
    );
  });

  it("should render a chapter without its script or its remote image", async () => {
    render(<BookReader attachmentId={"a".repeat(32)} mime="application/epub+zip" name="book" />);
    // The chapter is read on demand, so wait for its markup rather than for the frame around it.
    await waitFor(() =>
      expect(screen.getByTestId("reader-body").innerHTML).toContain("A second paragraph"),
    );
    // The fixture's chapters carry no script; what matters is that the sanitiser ran and the words arrived in
    // the elements it kept.
    const body = screen.getByTestId("reader-body").innerHTML;
    expect(body).toContain("<p>");
    expect(body).toContain("A second paragraph");
    expect(body).not.toContain("<script");
    // The book's own stylesheet is dropped, so our type is what a chapter draws in.
    expect(body).not.toContain("font-family");
  });

  it("should say a book cannot be opened rather than showing an empty page", async () => {
    bytes.value = new TextEncoder().encode("this is not a book") as Uint8Array<ArrayBuffer>;
    render(<BookReader attachmentId={"a".repeat(32)} mime="application/epub+zip" name="book" />);

    await waitFor(() => expect(screen.getByTestId("book-refused")).toBeInTheDocument());
    expect(screen.getByText(/not a zip archive/u)).toBeInTheDocument();
  });

  it("should refuse an archive that is not a book, and name what is missing", async () => {
    const { zipOf } = await import("../archive/epub/fixture");
    bytes.value = (await zipOf([
      { path: "mimetype", text: "application/epub+zip" },
    ])) as Uint8Array<ArrayBuffer>;
    render(<BookReader attachmentId={"a".repeat(32)} mime="application/epub+zip" name="book" />);

    await waitFor(() => expect(screen.getByTestId("book-refused")).toBeInTheDocument());
    expect(screen.getByText(/container\.xml/u)).toBeInTheDocument();
  });
});

describe("a book with a highlight", () => {
  it("should open with a mark already in it, which is the render that crashed", async () => {
    // The first render of a book *with* highlights is a different code path from a book with none: the derived state
    // is only evaluated when there is something to find. A suite that only ever opened an unmarked book missed it.
    const workspace = useCanvasStore.getState().workspace;
    workspace?.addAnnotation({
      sourceCardId: bookCardId,
      styleId: "style-yellow",
      anchor: {
        kind: "quote",
        locator: "2",
        quote: "The first sentence of the book.",
        prefix: "",
        suffix: "",
      },
      excerpt: "The first sentence of the book.",
    });

    render(
      <BookReader
        attachmentId={"a".repeat(32)}
        mime="application/epub+zip"
        name="book"
        sourceCardId={bookCardId}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("reader-body").textContent).toContain("The first sentence"),
    );
    // The passage is painted onto the words it covers, which is what a highlight is.
    expect(document.querySelector("mark.reader-highlight")).not.toBeNull();
  });

  it("should list the mark in the book's own panel, and raise it on a press", async () => {
    const workspace = useCanvasStore.getState().workspace;
    workspace?.addAnnotation({
      sourceCardId: bookCardId,
      styleId: "style-yellow",
      anchor: {
        kind: "quote",
        locator: "2",
        quote: "The first sentence of the book.",
        prefix: "",
        suffix: "",
      },
      excerpt: "The first sentence of the book.",
    });

    render(
      <BookReader
        attachmentId={"a".repeat(32)}
        mime="application/epub+zip"
        name="book"
        sourceCardId={bookCardId}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("reader-highlights-toggle")).toBeInTheDocument());

    screen.getByTestId("reader-highlights-toggle").click();
    await waitFor(() => expect(screen.getByTestId("book-highlights")).toBeInTheDocument());

    const row = within(screen.getByTestId("book-highlights")).getAllByRole("button")[0];
    if (row === undefined) throw new Error("no highlight row");
    row.click();
    await waitFor(() => expect(screen.getByTestId("highlight-raise")).toBeInTheDocument());
  });
});
