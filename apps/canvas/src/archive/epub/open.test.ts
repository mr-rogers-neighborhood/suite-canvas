import { describe, expect, it } from "vitest";
import {
  bookEntries,
  flatPathBook,
  fontObfuscatedBook,
  ncxOnlyBook,
  protectedBook,
  zipOf,
} from "./fixture";
import { openEpub, protectionOf } from "./open";

async function open(entries = bookEntries()) {
  return openEpub(await zipOf(entries));
}

/**
 * The sentence a refusal carries.
 *
 * Reading the message off the error rather than matching with `rejects.toThrow`: in this environment a
 * rejected promise reaches the matcher with an empty message, which is a Vitest/Node mismatch and not a
 * property of the code.
 */
async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("opening a book", () => {
  it("should name the book, its author and its language", async () => {
    const { book } = await open();
    expect(book.title).toBe("A Small Book");
    expect(book.creator).toBe("Ada Lovelace");
    expect(book.language).toBe("en");
    expect(book.identifier).toBe("urn:uuid:1234");
    expect(book.rights).toBe("Public domain");
  });

  it("should read the spine in order and resolve its paths against the package", async () => {
    const { book, chapters } = await open();

    // The spine names a cover page the manifest does not declare: a book in the wild does this, and a
    // reader that threw on it would refuse a book that reads perfectly well.
    expect(book.spine.map((item) => item.path)).toEqual([
      "OEBPS/text/chapter1.xhtml",
      "OEBPS/text/chapter2.xhtml",
    ]);
    expect(chapters).toEqual(["OEBPS/text/chapter1.xhtml", "OEBPS/text/chapter2.xhtml"]);
    expect(book.spine[0]?.linear).toBe(true);
  });

  it("should resolve a package that spells its paths flat, without the directory", async () => {
    const { book } = await openEpub(await zipOf(flatPathBook()));
    expect(book.spine.map((item) => item.path)).toEqual([
      "text/chapter1.xhtml",
      "text/chapter2.xhtml",
    ]);
  });

  it("should read the nav document, with its nesting and its fragments", async () => {
    const { book } = await open();
    expect(book.toc).toEqual([
      { label: "One", path: "OEBPS/text/chapter1.xhtml", fragment: null, depth: 0 },
      {
        label: "Two, and a place inside it",
        path: "OEBPS/text/chapter2.xhtml",
        fragment: "part-two",
        depth: 0,
      },
      { label: "Deeper", path: "OEBPS/text/chapter2.xhtml", fragment: "deeper", depth: 1 },
    ]);
  });

  it("should fall back to an NCX when the book has no nav document", async () => {
    const { book } = await openEpub(await zipOf(ncxOnlyBook()));
    expect(book.toc.map((entry) => [entry.label, entry.depth])).toEqual([
      ["Chapter one", 0],
      ["Chapter two", 0],
      ["Deep", 1],
    ]);
    expect(book.toc[2]?.fragment).toBe("deeper");
  });

  it("should find the cover the package declares", async () => {
    const { book, readResource } = await open();
    expect(book.coverPath).toBe("OEBPS/images/cover.png");
    const bytes = await readResource("OEBPS/images/cover.png");
    expect(bytes?.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("should read one chapter's markup without reading the rest", async () => {
    const { readChapter } = await open();
    const xml = await readChapter("OEBPS/text/chapter1.xhtml");
    expect(xml).toContain("The first sentence of the book.");
    expect(await readChapter("OEBPS/text/missing.xhtml")).toBeNull();
  });

  it("should say a book is reflowable when it says so", async () => {
    const { book } = await open();
    expect(book.fixedLayout).toBe(false);
  });

  it("should refuse a file that is not an archive, and one that is not an EPUB", async () => {
    expect(await refusalOf(openEpub(new TextEncoder().encode("a note")))).toContain(
      "not a zip archive",
    );
    const noContainer = await zipOf([{ path: "mimetype", text: "application/epub+zip" }]);
    expect(await refusalOf(openEpub(noContainer))).toContain("no META-INF/container.xml");
  });

  it("should name the package path it could not find rather than failing silently", async () => {
    const broken = await zipOf([
      { path: "mimetype", text: "application/epub+zip" },
      { path: "META-INF/container.xml", text: bookEntries()[2]?.text ?? "" },
    ]);
    expect(await refusalOf(openEpub(broken))).toContain("OEBPS/content.opf");
  });

  it("should read the mimetype the book declares", async () => {
    const { mimetype } = await open();
    expect(mimetype).toBe("application/epub+zip");
  });
});

describe("a protected book", () => {
  it("should be refused when its content is encrypted", async () => {
    expect(await protectionOf(await zipOf(protectedBook()))).toContain("cannot open");
  });

  it("should be read normally when only its fonts are obfuscated", async () => {
    // Font obfuscation is ordinary; treating it as DRM would refuse books that read perfectly well.
    expect(await protectionOf(await zipOf(fontObfuscatedBook()))).toBeNull();
    const { book } = await openEpub(await zipOf(fontObfuscatedBook()));
    expect(book.title).toBe("A Small Book");
  });

  it("should not report protection on an ordinary book", async () => {
    expect(await protectionOf(await zipOf(bookEntries()))).toBeNull();
  });
});
