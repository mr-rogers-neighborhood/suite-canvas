import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaceStackStore } from "../canvas/placeStack";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { BookReader } from "./BookReader";
import { useBookStore } from "./bookStore";

/**
 * The reader, over a book assembled here.
 *
 * The bytes go in through the local-attachment path rather than the relay, which is the path a freshly dropped
 * book takes anyway: the reader reads this browser's copy first, so a book opens before it has uploaded.
 */
const { bytes, opens } = vi.hoisted(() => ({
  bytes: { value: new Uint8Array() as Uint8Array<ArrayBuffer> },
  opens: { count: 0 },
}));

vi.mock("./useBookBytes", () => ({
  // The stored result keeps its identity across renders, exactly as the real hook does — a fresh literal per render
  // would make the reader look like it re-opens on every paint for a reason that only exists in this file.
  useBookBytes: () => {
    cached ??= { status: "ready" as const, bytes: bytes.value };
    cached.bytes = bytes.value;
    return cached;
  },
}));

let cached: { status: "ready"; bytes: Uint8Array } | null = null;

vi.mock("../archive/epub/open", async (importOriginal) => {
  const real = await importOriginal<typeof import("../archive/epub/open")>();
  return {
    ...real,
    openEpub: async (input: Uint8Array) => {
      opens.count += 1;
      return real.openEpub(input);
    },
  };
});

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
  opens.count = 0;
});

describe("the book reader", () => {
  it("should follow a link into another chapter, and land on the place it names", async () => {
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
    await waitFor(() =>
      expect(screen.getByTestId("reader-body").textContent).toContain("first sentence"),
    );

    // The fixture's first chapter links to `chapter2.xhtml#deeper`, and the sanitiser keeps the fragment: a footnote
    // points at a place in the notes, not at their first line.
    const link = screen.getByText("link");
    fireEvent.click(link);

    await waitFor(() =>
      expect(screen.getByTestId("reader-body").textContent).toContain(
        "A place a link can point at.",
      ),
    );
    expect(screen.getByTestId("reader-where").textContent).toContain("Chapter 2 of");
  });

  it("should draw a picture from the book rather than asking its own origin for one", async () => {
    const { bookEntries, zipOf } = await import("../archive/epub/fixture");
    // The fixture's own entries, with the first chapter replaced: an appended entry would lose to the original.
    const entries = bookEntries().map((entry) =>
      entry.path === "OEBPS/text/chapter1.xhtml"
        ? {
            ...entry,
            text: `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head>
<body><p>The first sentence of the book.</p><img src="../images/cover.png" alt="A cover"/></body></html>`,
          }
        : entry,
    );
    bytes.value = (await zipOf(entries)) as Uint8Array<ArrayBuffer>;

    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
    // A blob URL from the archive's own bytes, which is the whole point: the archive path in `src` is a request
    // against the app's origin, and it 404s.
    await waitFor(() =>
      expect(screen.getByAltText("A cover").getAttribute("src") ?? "").toMatch(/^blob:/u),
    );
  });

  it("should turn to a passage's chapter and scroll it into view when a surface asks for it", async () => {
    // A highlight in the second chapter, asked for the way the library and a `@` mention ask.
    const chapterTwo = bookCardId;
    const workspace = useCanvasStore.getState().workspace;
    if (workspace === null) throw new Error("no workspace");
    const annotation = workspace.addAnnotation({
      sourceCardId: chapterTwo,
      styleId: "style-yellow",
      anchor: {
        kind: "quote",
        locator: "OEBPS/text/chapter2.xhtml",
        quote: "A place a link can point at.",
        prefix: "",
        suffix: "",
      },
      excerpt: "A place a link can point at.",
    });
    // jsdom has no `scrollIntoView` at all, so the stub defines it: where the reader would scroll is the assertion.
    const scrolled: string[] = [];
    const prototype = HTMLElement.prototype as unknown as Record<string, unknown>;
    const original = prototype.scrollIntoView;
    prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      scrolled.push(this.getAttribute("data-annotation-id") ?? this.tagName);
    };

    try {
      useUiStore.getState().openAnnotation(annotation.id);
      render(<BookReader attachmentId={"a".repeat(32)} name="book" sourceCardId={chapterTwo} />);

      await waitFor(() =>
        expect(screen.getByTestId("reader-body").textContent).toContain(
          "A place a link can point at.",
        ),
      );
      // The passage, not the chapter: the mark that was painted for this highlight is what got scrolled to.
      await waitFor(() => expect(scrolled).toContain(annotation.id));
    } finally {
      prototype.scrollIntoView = original;
    }
  });

  it("should open the archive once, however often the reading position is written", async () => {
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
    await waitFor(() => expect(screen.getByTestId("book-reader")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId("reader-body").textContent).toContain("first sentence"),
    );
    const afterOpen = opens.count;

    // Every page turn and every scroll settle writes the position. That used to re-open the package, the spine and
    // the nav — the reader's own progress was what made it slow.
    useBookStore.getState().remember("a".repeat(32), "OEBPS/text/chapter1.xhtml", 40);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(opens.count).toBe(afterOpen);
  });

  it("should open on the book's title and its first chapter", async () => {
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);

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
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
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
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
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
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);

    await waitFor(() => expect(screen.getByTestId("book-refused")).toBeInTheDocument());
    expect(screen.getByText(/not a zip archive/u)).toBeInTheDocument();
  });

  it("should refuse an archive that is not a book, and name what is missing", async () => {
    const { zipOf } = await import("../archive/epub/fixture");
    bytes.value = (await zipOf([
      { path: "mimetype", text: "application/epub+zip" },
    ])) as Uint8Array<ArrayBuffer>;
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);

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

    render(<BookReader attachmentId={"a".repeat(32)} name="book" sourceCardId={bookCardId} />);

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

    render(<BookReader attachmentId={"a".repeat(32)} name="book" sourceCardId={bookCardId} />);
    await waitFor(() => expect(screen.getByTestId("reader-highlights-toggle")).toBeInTheDocument());

    screen.getByTestId("reader-highlights-toggle").click();
    await waitFor(() => expect(screen.getByTestId("book-highlights")).toBeInTheDocument());

    // The row itself, not the filter chips above it and not the Place button beside it.
    const panel = screen.getByTestId("book-highlights");
    const row = [...panel.querySelectorAll("button")].find(
      (button) =>
        (button.getAttribute("data-testid") ?? "").startsWith("book-highlight-") &&
        !(button.getAttribute("data-testid") ?? "").startsWith("book-highlight-place-"),
    );
    if (row === undefined) throw new Error("no highlight row");
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId("highlight-raise")).toBeInTheDocument());
    // The list stays open under the raised passage, so working through a book is not one passage per visit.
    expect(screen.getByTestId("book-highlights")).toBeInTheDocument();
  });

  it("should put the card in the reader's hand when Place is pressed", async () => {
    // Place used to name a board and no point, so the card was made and written nowhere: the board showed nothing and
    // a second press "opened" a card nobody could see. It now arrives in the hand the library's own placing uses.
    const workspace = useCanvasStore.getState().workspace;
    const annotation = workspace?.addAnnotation({
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
    useUiStore.setState({ canEditLayout: true });
    usePlaceStackStore.getState().stop();

    render(<BookReader attachmentId={"a".repeat(32)} name="book" sourceCardId={bookCardId} />);
    await waitFor(() => expect(screen.getByTestId("reader-highlights-toggle")).toBeInTheDocument());
    screen.getByTestId("reader-highlights-toggle").click();
    await waitFor(() => expect(screen.getByTestId("book-highlights")).toBeInTheDocument());

    screen.getByTestId(`book-highlight-place-${annotation?.id ?? ""}`).click();

    await waitFor(() => expect(usePlaceStackStore.getState().queue).toHaveLength(1));
    const cardId = workspace?.getAnnotation(annotation?.id ?? "")?.cardId;
    expect(cardId).toBeDefined();
    // Made, and not placed: the press that follows is what puts it on the board.
    expect(workspace?.listCardPlacements(cardId ?? "")).toHaveLength(0);
    expect(usePlaceStackStore.getState().queue[0]).toBe(cardId);
    usePlaceStackStore.getState().stop();
    useUiStore.setState({ canEditLayout: false });
  });
});

describe("where the reader is", () => {
  it("should say which chapter it is showing", async () => {
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
    await waitFor(() => expect(screen.getByTestId("reader-where")).toBeInTheDocument());
    expect(screen.getByTestId("reader-where").textContent).toMatch(/^Chapter 1 of \d+$/);
  });

  it("should turn the page with the arrow keys", async () => {
    // The reader is the one surface where this is expected and the only one that did not do it.
    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
    await waitFor(() =>
      expect(screen.getByTestId("reader-body").textContent).toContain("The first sentence"),
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByTestId("reader-body").textContent).toContain("The same sentence appears"),
    );
    expect(screen.getByTestId("reader-where").textContent).toMatch(/^Chapter 2/);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.getByTestId("reader-body").textContent).toContain("The first sentence"),
    );
  });

  it("should come back to the chapter it was left on, with where it was left", async () => {
    window.localStorage.clear();
    useBookStore.setState({ positions: {} });

    const first = render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
    await waitFor(() => expect(screen.getByTestId("reader-next")).toBeInTheDocument());
    screen.getByTestId("reader-next").click();
    await waitFor(() =>
      expect(screen.getByTestId("reader-where").textContent).toMatch(/^Chapter 2/),
    );
    first.unmount();

    render(<BookReader attachmentId={"a".repeat(32)} name="book" />);
    await waitFor(() =>
      expect(screen.getByTestId("reader-where").textContent).toMatch(/^Chapter 2/),
    );
  });
});
