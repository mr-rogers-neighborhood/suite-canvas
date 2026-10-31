import { describe, expect, it } from "vitest";
import { bookEntryOf, forgetBooks, useBookMeta } from "./bookMeta";

/**
 * The three states, and why there are three.
 *
 * Two states made "not read yet" and "read, no cover" the same answer, so a first paint that raced an upload marked a
 * book finished and the cover stayed missing until a refresh. These assert the distinction rather than the extraction,
 * which the archive tests own.
 */
describe("what this session knows about a book", () => {
  it("should start pending, which is not the same as having no cover", () => {
    forgetBooks();
    expect(bookEntryOf("a".repeat(32))).toEqual({ status: "pending" });
  });

  it("should keep a pending book retryable rather than marking it finished", () => {
    forgetBooks();
    // Pending is the absence of an entry: nothing has been decided about this book, so a later read can still find
    // its cover. Nothing here writes `none`, which is what used to close the door.
    const id = "b".repeat(32);
    expect(useBookMeta.getState().entries[id]).toBeUndefined();
    expect(bookEntryOf(id).status).toBe("pending");
  });

  it("should carry what the book said once it has been read", () => {
    forgetBooks();
    const id = "c".repeat(32);
    useBookMeta.getState().publish(id, {
      status: "ready",
      meta: { title: "A Small Book", creator: "Ada Lovelace", chapters: 2 },
      coverUrl: null,
    });

    const entry = bookEntryOf(id);
    expect(entry.status).toBe("ready");
    if (entry.status === "ready") {
      expect(entry.meta.title).toBe("A Small Book");
      expect(entry.coverUrl).toBeNull();
    }
  });

  it("should keep a refusal apart from a missing cover", () => {
    forgetBooks();
    const id = "d".repeat(32);
    useBookMeta
      .getState()
      .publish(id, { status: "none", reason: "this file is not a zip archive" });

    const entry = bookEntryOf(id);
    expect(entry.status).toBe("none");
    if (entry.status === "none") expect(entry.reason).toContain("not a zip");
  });
});
