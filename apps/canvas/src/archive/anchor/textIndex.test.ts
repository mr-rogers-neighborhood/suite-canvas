import { describe, expect, it } from "vitest";
import { chapterTextIndex, rangeOf } from "./textIndex";

/**
 * The flat text a quote is searched in.
 *
 * A reader's selection across two paragraphs comes back from the browser normalised to single spaces, so the index
 * has to separate blocks with a space whether or not the markup happens to contain one. It usually does not:
 * `<p>one</p><p>two</p>` has nothing between the tags, and the stored quote "one two" could then never be found, which
 * is why a highlight spanning a paragraph break disappeared with no message.
 */
function chapter(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("the flat text of a chapter", () => {
  it("should separate two paragraphs the markup left adjacent", () => {
    const index = chapterTextIndex(chapter("<p>One.</p><p>Two.</p>"));
    expect(index.text).toBe("One. Two.");
  });

  it("should collapse the newline a formatted book leaves between paragraphs", () => {
    const index = chapterTextIndex(chapter("<p>One.</p>\n  <p>Two.</p>"));
    expect(index.text).toBe("One. Two.");
  });

  it("should not separate an inline split, because it is one word", () => {
    const index = chapterTextIndex(chapter("<p>The <em>first</em> sentence.</p>"));
    expect(index.text).toBe("The first sentence.");
  });

  it("should keep every run's offsets exact inside its own node", () => {
    const root = chapter("<p>One.</p><p>Two.</p>");
    const index = chapterTextIndex(root);
    // "Two." begins at 5 in the flat text and at 0 in its own node.
    const range = rangeOf(index, 5, 9);
    expect(range?.toString()).toBe("Two.");
  });

  it("should map a range that spans both paragraphs", () => {
    const root = chapter("<p>One.</p><p>Two.</p>");
    const index = chapterTextIndex(root);
    const range = rangeOf(index, 2, 7);
    expect(range?.toString()).toContain("e.");
    expect(range?.toString()).toContain("Tw");
  });
});
