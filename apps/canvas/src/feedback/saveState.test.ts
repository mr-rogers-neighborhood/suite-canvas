import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDurabilityStore } from "../storage/durability";
import { useCanvasStore } from "../store/useCanvasStore";
import { SAVE_SETTLE_MS, saveStateOf, useSaveState } from "./saveState";

beforeEach(() => {
  useCanvasStore.setState({ ready: true });
  useDurabilityStore.setState({ quota: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saveStateOf", () => {
  it("should read saved when the document is hydrated and this device can keep it", () => {
    expect(saveStateOf({ ready: true, saving: false, durable: true, quota: false })).toBe("saved");
  });

  it("should read saving while a local commit settles and while hydration runs", () => {
    expect(saveStateOf({ ready: true, saving: true, durable: true, quota: false })).toBe("saving");
    expect(saveStateOf({ ready: false, saving: false, durable: true, quota: false })).toBe(
      "saving",
    );
  });

  /** The strongest fact: a refused write leaves the copy in this tab only. */
  it("should read not durable when the write was refused or there is nowhere to write", () => {
    expect(saveStateOf({ ready: true, saving: false, durable: true, quota: true })).toBe(
      "not-durable",
    );
    expect(saveStateOf({ ready: true, saving: false, durable: false, quota: false })).toBe(
      "not-durable",
    );
  });
});

describe("useSaveState", () => {
  it("should settle back to saved after a local commit", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSaveState(true));
    expect(result.current).toBe("saved");

    act(() => {
      useCanvasStore.getState().workspace.createCard();
    });
    expect(result.current).toBe("saving");

    act(() => {
      vi.advanceTimersByTime(SAVE_SETTLE_MS + 1);
    });
    expect(result.current).toBe("saved");
  });

  it("should stay not durable on a device with no local persistence", () => {
    const { result } = renderHook(() => useSaveState(false));
    expect(result.current).toBe("not-durable");
  });

  it("should report a refused write over everything else", () => {
    const { result } = renderHook(() => useSaveState(true));
    act(() => {
      useDurabilityStore.setState({ quota: { message: "Storage is full", at: Date.now() } });
    });

    expect(result.current).toBe("not-durable");
  });
});
