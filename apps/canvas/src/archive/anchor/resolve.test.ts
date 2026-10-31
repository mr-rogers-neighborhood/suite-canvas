import { describe, expect, it } from "vitest";
import { occurrences, resolveQuote } from "./resolve";
import { surroundings } from "./textIndex";

function anchor(quote: string, prefix = "", suffix = ""): Parameters<typeof resolveQuote>[1] {
  return { kind: "quote", locator: "2", quote, prefix, suffix };
}

const CHAPTER =
  "The first sentence of the book. A second sentence follows it. The same sentence appears twice." +
  " Something in between. The same sentence appears twice.";

describe("resolving a quote", () => {
  it("should find a unique quote with or without its surroundings", () => {
    const result = resolveQuote(CHAPTER, anchor("A second sentence follows it."));
    expect(result).toEqual({
      status: "found",
      start: CHAPTER.indexOf("A second"),
      end: CHAPTER.indexOf("A second") + "A second sentence follows it.".length,
      exact: false,
    });
  });

  it("should use the surroundings to choose between two identical sentences", () => {
    const first = CHAPTER.indexOf("The same sentence appears twice.");
    const second = CHAPTER.indexOf("The same sentence appears twice.", first + 1);
    // Exactly what a reader's selection stores: the words, and the text either side of them.
    const around = surroundings(
      CHAPTER,
      second,
      second + "The same sentence appears twice.".length,
    );
    const result = resolveQuote(
      CHAPTER,
      anchor("The same sentence appears twice.", around.prefix, around.suffix),
    );
    expect(result).toMatchObject({ status: "found", start: second, exact: true });
    expect(second).toBeGreaterThan(first);
  });

  it("should refuse to guess when the same quote appears twice", () => {
    // Marking the wrong sentence is worse than saying so, because the reader cannot tell it happened.
    expect(resolveQuote(CHAPTER, anchor("The same sentence appears twice."))).toEqual({
      status: "ambiguous",
      candidates: 2,
    });
  });

  it("should find a quote at the very start of a chapter, where there is no prefix", () => {
    expect(
      resolveQuote(CHAPTER, anchor("The first sentence of the book.", "", " A second")),
    ).toMatchObject({ status: "found", start: 0 });
  });

  it("should find a quote at the very end, where there is no suffix", () => {
    const last = CHAPTER.lastIndexOf("The same sentence appears twice.");
    const result = resolveQuote(
      CHAPTER,
      anchor("The same sentence appears twice.", " Something in between. ", ""),
    );
    expect(result).toMatchObject({ status: "found", start: last });
  });

  it("should say the words are gone rather than place a mark somewhere else", () => {
    expect(resolveQuote(CHAPTER, anchor("A sentence nobody wrote.", " x", "y"))).toEqual({
      status: "missing",
    });
  });

  it("should still find a quote after the text around it was edited", () => {
    // An edit on one side keeps the other side's 32 characters, which is what the scored pass is for.
    const edited = `An inserted line. ${CHAPTER}`;
    const result = resolveQuote(
      edited,
      anchor("A second sentence follows it.", " book. ", " The same"),
    );
    expect(result).toMatchObject({ status: "found" });
    if (result.status === "found") {
      expect(edited.slice(result.start, result.end)).toBe("A second sentence follows it.");
    }
  });

  it("should be indifferent to how wide the column is, because a quote is not an offset", () => {
    // The same anchor against the same text is the same span, whatever the layout did.
    const narrow = CHAPTER;
    const wide = CHAPTER.replace(/\. /gu, ".\n\n");
    const fromNarrow = resolveQuote(narrow, anchor("A second sentence follows it."));
    const fromWide = resolveQuote(wide, anchor("A second sentence follows it."));
    expect(fromNarrow.status).toBe("found");
    expect(fromWide.status).toBe("found");
  });

  it("should refuse an empty quote instead of matching the whole chapter", () => {
    expect(resolveQuote(CHAPTER, anchor(""))).toEqual({ status: "missing" });
  });

  it("should find every occurrence, including overlapping ones", () => {
    expect(occurrences("aaaa", "aa")).toEqual([0, 1, 2]);
    expect(occurrences("abcabc", "abc")).toEqual([0, 3]);
    expect(occurrences("abc", "")).toEqual([]);
  });
});
