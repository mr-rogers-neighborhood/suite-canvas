import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBookStore } from "./bookStore";

/**
 * The place a reader stopped.
 *
 * A reading position is device state, never a fact about the document: two people looking at one book card are not in
 * the same place. It is kept in `localStorage`, and it grew an offset so a reader who stopped mid-chapter comes back
 * mid-chapter rather than at the top of whatever they were reading.
 */
const STORAGE_KEY = "suite.reader.v1";

beforeEach(() => {
  window.localStorage.clear();
  useBookStore.setState({ positions: {} });
});

afterEach(() => {
  window.localStorage.clear();
});

describe("a reading position", () => {
  it("should remember the chapter and how far down it the reader was", () => {
    useBookStore.getState().remember("book", "chapter-2", 320);
    expect(Object.values(useBookStore.getState().positions)).toEqual([
      { path: "chapter-2", offset: 320 },
    ]);
    // Written through, so the next reload opens where this one stopped.
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain("320");
  });

  it("should start a chapter at its top unless told otherwise", () => {
    useBookStore.getState().remember("book", "chapter-3");
    const only = Object.values(useBookStore.getState().positions)[0];
    expect(only).toEqual({ path: "chapter-3", offset: 0 });
  });

  it("should read a position written before offsets existed", async () => {
    // Older builds stored a bare chapter path. Losing every reader's place to a format change is not an option, and the
    // top of the chapter they were on is the honest reading of one. The store reads storage at import, so a fresh copy
    // of the module is what a reload is.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ "local/book": "chapter-4" }));
    vi.resetModules();
    const fresh = await import("./bookStore");
    expect(fresh.useBookStore.getState().positions["local/book"]).toEqual({
      path: "chapter-4",
      offset: 0,
    });
  });

  it("should never store a negative offset", () => {
    useBookStore.getState().remember("book", "chapter-1", -40);
    const only = Object.values(useBookStore.getState().positions)[0];
    expect(only?.offset).toBe(0);
  });
});
