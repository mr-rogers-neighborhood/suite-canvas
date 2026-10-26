import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  announce,
  announceRedo,
  announceUndo,
  REPEAT_WINDOW_MS,
  resetAnnouncerForTests,
  useAnnouncerStore,
} from "./announcer";

beforeEach(() => {
  resetAnnouncerForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("announce", () => {
  it("should speak politely by default and assertively only when asked", () => {
    announce("Card created");
    expect(useAnnouncerStore.getState().polite?.message).toBe("Card created");
    expect(useAnnouncerStore.getState().assertive).toBeNull();

    announce("This device is out of storage", { urgent: true });
    expect(useAnnouncerStore.getState().assertive?.message).toBe("This device is out of storage");
    expect(useAnnouncerStore.getState().polite?.message).toBe("Card created");
  });

  it("should ignore an empty sentence", () => {
    announce("   ");
    expect(useAnnouncerStore.getState().polite).toBeNull();
  });

  it("should collapse the same sentence from two owners inside the window", () => {
    announce("Card created");
    const first = useAnnouncerStore.getState().polite;

    announce("Card created");
    expect(useAnnouncerStore.getState().polite).toEqual(first);
  });

  it("should speak the same sentence again once the window has passed", () => {
    announce("Ada left");
    const first = useAnnouncerStore.getState().polite;

    vi.advanceTimersByTime(REPEAT_WINDOW_MS + 1);
    announce("Ada left");

    const second = useAnnouncerStore.getState().polite;
    expect(second?.id).not.toBe(first?.id);
    expect(second?.message).toBe("Ada left");
  });

  it("should name the two structural history commands", () => {
    announceUndo();
    expect(useAnnouncerStore.getState().polite?.message).toBe("Undo");

    announceRedo();
    expect(useAnnouncerStore.getState().polite?.message).toBe("Redo");
  });
});
