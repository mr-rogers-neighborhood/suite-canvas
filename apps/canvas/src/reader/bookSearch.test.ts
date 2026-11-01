import { describe, expect, it } from "vitest";
import { type BookText, offsetOfHit, rangeOfHit, searchBook, textOfMarkup } from "./bookSearch";

/**
 * Searching inside a book.
 *
 * A reader looking for a passage has the words, not the chapter, and a table of contents cannot answer that. The search
 * runs over the sanitiser's output, because the words on the page are what they are looking for: an offset into the raw
 * XHTML would point at markup.
 */
const BOOK: BookText = {
  chapters: [
    {
      path: "OEBPS/text/one.xhtml",
      title: "One",
      text: "Retrieval practice is the point. Testing yourself beats re-reading.",
    },
    {
      path: "OEBPS/text/two.xhtml",
      title: "Two",
      text: "A second chapter about spacing, and about retrieval again.",
    },
    { path: "OEBPS/text/three.xhtml", title: "Three", text: "Nothing to do with it." },
  ],
};

describe("searching a book", () => {
  it("should find every chapter a word appears in, and say how many hits there are", () => {
    const result = searchBook(BOOK, "retrieval");

    expect(result.chapters.map((chapter) => chapter.path)).toEqual([
      "OEBPS/text/one.xhtml",
      "OEBPS/text/two.xhtml",
    ]);
    expect(result.total).toBe(2);
  });

  it("should ignore case, in both directions", () => {
    expect(searchBook(BOOK, "RETRIEVAL").total).toBe(2);
    expect(searchBook(BOOK, "ReTrIeVal").total).toBe(2);
  });

  it("should quote the words from the book, not from the query", () => {
    const [first] = searchBook(BOOK, "retrieval").chapters;
    // The reader typed lower case; the book capitalised it, and the row has to show the book's own words.
    expect(first?.hits[0]?.match).toBe("Retrieval");
  });

  it("should show the words either side, so a hit reads as a sentence", () => {
    const [first] = searchBook(BOOK, "practice").chapters;
    expect(first?.hits[0]?.before).toBe("Retrieval ");
    expect(first?.hits[0]?.after).toContain("is the point");
  });

  it("should treat punctuation as punctuation rather than as a pattern", () => {
    // A reader typing `(` means a bracket. A search built on a regular expression would throw here.
    expect(() => searchBook(BOOK, "(retrieval")).not.toThrow();
    expect(searchBook(BOOK, "(retrieval").total).toBe(0);
  });

  it("should return nothing for an empty query rather than every chapter", () => {
    expect(searchBook(BOOK, "   ")).toEqual({ chapters: [], total: 0 });
  });

  it("should cap the rows one chapter can return", () => {
    const repetitive: BookText = {
      chapters: [{ path: "a", title: "A", text: "word ".repeat(200) }],
    };
    expect(searchBook(repetitive, "word", 5).total).toBe(5);
  });
});

describe("the text a chapter is searched as", () => {
  it("should read the sanitiser's markup as words, with blocks separated", () => {
    // Two paragraphs are two words apart: without the separator, a hit could span a boundary nobody wrote.
    expect(textOfMarkup("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("should ignore the markup itself", () => {
    expect(textOfMarkup("<p>A <em>marked</em> word</p>")).toBe("A marked word");
  });

  it("should find the offset of a hit in the flat text", () => {
    const text = "Retrieval practice is the point.";
    expect(offsetOfHit(text, "practice")).toBe(10);
    expect(offsetOfHit(text, "missing")).toBeNull();
  });
});

/**
 * Landing on a hit.
 *
 * The index counts characters in the sanitiser's text and the browser hands back its own text nodes, so a hit is found
 * again in the drawn chapter rather than trusted by offset: the same words, counted the same way.
 */
describe("landing on a hit", () => {
  const draw = (html: string): HTMLElement => {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.append(root);
    return root;
  };

  it("should find a hit inside one paragraph and cover exactly its words", () => {
    const root = draw("<p>Spacing and retrieval, again.</p>");
    const range = rangeOfHit(root, "retrieval", 0);
    expect(range?.toString()).toBe("retrieval");
  });

  it("should find a hit that crosses an element boundary", () => {
    const root = draw("<p>Spacing and <em>retrieval</em> practice.</p>");
    expect(rangeOfHit(root, "retrieval practice", 0)?.toString()).toBe("retrieval practice");
  });

  it("should count occurrences so the second one is the one turned to", () => {
    const root = draw("<p>retrieval one</p><p>retrieval two</p>");
    expect(rangeOfHit(root, "retrieval", 0)?.startContainer.parentElement?.textContent).toBe(
      "retrieval one",
    );
    expect(rangeOfHit(root, "retrieval", 1)?.startContainer.parentElement?.textContent).toBe(
      "retrieval two",
    );
  });

  it("should match across the whitespace a chapter is indented with", () => {
    const root = draw("<div>\n  <p>one\n  two</p>\n</div>");
    expect(rangeOfHit(root, "one two", 0)?.toString()).toBe("one\n  two");
  });

  it("should answer nothing for a word the chapter does not hold", () => {
    expect(rangeOfHit(draw("<p>spacing</p>"), "retrieval", 0)).toBeNull();
  });

  it("should answer nothing for an occurrence past the end", () => {
    expect(rangeOfHit(draw("<p>retrieval</p>"), "retrieval", 3)).toBeNull();
  });

  it("should ignore case the way the search does", () => {
    expect(rangeOfHit(draw("<p>Retrieval Practice</p>"), "retrieval practice", 0)?.toString()).toBe(
      "Retrieval Practice",
    );
  });
});
