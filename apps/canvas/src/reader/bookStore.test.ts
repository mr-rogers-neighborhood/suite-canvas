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
      expect.objectContaining({ path: "chapter-2", offset: 320 }),
    ]);
    // Written through, so the next reload opens where this one stopped.
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain("320");
  });

  it("should start a chapter at its top unless told otherwise", () => {
    useBookStore.getState().remember("book", "chapter-3");
    const only = Object.values(useBookStore.getState().positions)[0];
    expect(only).toEqual(expect.objectContaining({ path: "chapter-3", offset: 0 }));
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
      progress: 0,
      at: 0,
    });
  });

  it("should never store a negative offset", () => {
    useBookStore.getState().remember("book", "chapter-1", -40);
    const only = Object.values(useBookStore.getState().positions)[0];
    expect(only?.offset).toBe(0);
  });

  /**
   * How far through the book the reader is.
   *
   * Stored rather than derived, because the library has a book's card and not the book: a bar needs a number, and only
   * the reader knows it. It is a fraction of the whole book, so a chapter is not mistaken for the book.
   */
  it("should remember how far through the whole book the reader is", () => {
    useBookStore.getState().remember("book", "chapter-2", 100, 0.42);
    const only = Object.values(useBookStore.getState().positions)[0];
    expect(only?.progress).toBe(0.42);
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain("0.42");
  });

  it("should keep progress inside the book, whatever it is told", () => {
    useBookStore.getState().remember("book", "chapter-2", 0, 4);
    expect(Object.values(useBookStore.getState().positions)[0]?.progress).toBe(1);
    useBookStore.getState().remember("book", "chapter-2", 0, -1);
    expect(Object.values(useBookStore.getState().positions)[0]?.progress).toBe(0);
  });

  it("should read a position stored before progress existed as unread rather than guessed", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ "local/book": { path: "chapter-1", offset: 90 } }),
    );
    vi.resetModules();
    const fresh = await import("./bookStore");
    expect(fresh.useBookStore.getState().positions["local/book"]).toEqual({
      path: "chapter-1",
      offset: 90,
      progress: 0,
      at: 0,
    });
  });

  it("should date every write, so the last book read can be found", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-02T03:04:05Z"));
      useBookStore.getState().remember("book", "chapter-1");
      expect(Object.values(useBookStore.getState().positions)[0]?.at).toBe(
        new Date("2026-01-02T03:04:05Z").getTime(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
