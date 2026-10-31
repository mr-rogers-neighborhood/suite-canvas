import { beforeEach, describe, expect, it } from "vitest";
import { isPinned, usePinStore } from "./pinStore";

const rect = { x: 12, y: 40, width: 240, height: 180 };
const moved = { x: 320, y: 96, width: 240, height: 180 };

describe("the pin store", () => {
  beforeEach(() => {
    usePinStore.getState().clear();
  });

  it("should pin cards in the order they were pinned and keep their rects", () => {
    usePinStore.getState().pin("a", rect);
    usePinStore.getState().pin("b", moved);

    expect(usePinStore.getState().pinned).toEqual(["a", "b"]);
    expect(usePinStore.getState().rects).toEqual({ a: rect, b: moved });
    expect(isPinned("a")).toBe(true);
    expect(isPinned("missing")).toBe(false);
  });

  it("should count a second pin of one card as a re-measure, not a second pin", () => {
    usePinStore.getState().pin("a", rect);
    usePinStore.getState().pin("a", moved);

    expect(usePinStore.getState().pinned).toEqual(["a"]);
    expect(usePinStore.getState().rects).toEqual({ a: moved });
  });

  it("should move a pinned card without changing the order", () => {
    usePinStore.getState().pin("a", rect);
    usePinStore.getState().pin("b", rect);
    usePinStore.getState().setRect("a", moved);

    expect(usePinStore.getState().pinned).toEqual(["a", "b"]);
    expect(usePinStore.getState().rects.a).toEqual(moved);
  });

  it("should ignore a rect for a card that is not pinned", () => {
    usePinStore.getState().setRect("a", moved);

    expect(usePinStore.getState().pinned).toEqual([]);
    expect(usePinStore.getState().rects).toEqual({});
  });

  it("should unpin one card and leave the rest in place", () => {
    usePinStore.getState().pin("a", rect);
    usePinStore.getState().pin("b", rect);
    usePinStore.getState().unpin("a");

    expect(usePinStore.getState().pinned).toEqual(["b"]);
    expect(usePinStore.getState().rects).toEqual({ b: rect });
    expect(isPinned("a")).toBe(false);
    expect(isPinned("b")).toBe(true);
  });

  it("should clear every pin", () => {
    usePinStore.getState().pin("a", rect);
    usePinStore.getState().pin("b", rect);
    usePinStore.getState().clear();

    expect(usePinStore.getState().pinned).toEqual([]);
    expect(usePinStore.getState().rects).toEqual({});
    expect(isPinned("a")).toBe(false);
  });
});
