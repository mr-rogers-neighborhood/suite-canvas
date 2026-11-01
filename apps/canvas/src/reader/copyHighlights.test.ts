import type { Annotation, AnnotationStyle } from "@suite/graph";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenedBook } from "../archive/epub/open";
import { copyHighlights } from "./copyHighlights";

/**
 * Taking a book's marks out of the app.
 *
 * The clipboard is the boundary, so it is stubbed and read back: what a reader ends up pasting is the whole of what this
 * produces, and the count is what the toast promises them.
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
];

function book(): OpenedBook {
  return {
    book: { title: "Make It Stick", creator: "Brown" },
    mimetype: null,
    chapters: ["OEBPS/text/one.xhtml", "OEBPS/text/two.xhtml"],
    readChapter: async () => null,
    readResource: async () => null,
  } as unknown as OpenedBook;
}

function annotation(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    sourceCardId: "book-1",
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "OEBPS/text/two.xhtml",
      quote: "The testing effect.",
      prefix: "",
      suffix: "",
    },
    excerpt: "The testing effect.",
    createdAt: 1,
    ...patch,
  };
}

const contents = [
  { path: "OEBPS/text/one.xhtml", label: "The effort of recall" },
  { path: "OEBPS/text/two.xhtml", label: "Spacing" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copying a book's highlights", () => {
  it("should copy the Markdown and answer how many passages it took", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: { writeText: (text: string) => void written.push(text) },
    });

    const count = await copyHighlights({
      book: book(),
      contents,
      annotations: [annotation(), annotation({ id: "a2" })],
      styles,
    });

    expect(count).toBe(2);
    expect(written[0]).toContain("# Make It Stick");
    // Named from the contents, not from the archive path: a reader pastes "Spacing", not "two.xhtml".
    expect(written[0]).toContain("## Spacing");
    expect(written[0]).toContain("> The testing effect.");
  });

  it("should still answer when the browser has no clipboard, rather than throwing in a press", async () => {
    vi.stubGlobal("navigator", {});
    await expect(
      copyHighlights({ book: book(), contents, annotations: [annotation()], styles }),
    ).resolves.toBe(1);
  });
});
