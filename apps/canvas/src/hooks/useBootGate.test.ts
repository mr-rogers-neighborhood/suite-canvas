import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBootGate } from "./useBootGate";

describe("useBootGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should hold the loader for the minimum time and then fade it out", () => {
    const { result } = renderHook(() =>
      useBootGate(true, { minMs: 500, exitMs: 100, now: () => 0 }),
    );

    expect(result.current).toEqual({ show: true, exiting: false });

    act(() => vi.advanceTimersByTime(499));
    expect(result.current.exiting).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.exiting).toBe(true);
    expect(result.current.show).toBe(true);

    act(() => vi.advanceTimersByTime(99));
    expect(result.current.show).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.show).toBe(false);
  });

  it("should keep the loader up until local hydration is ready", () => {
    const { result, rerender } = renderHook(
      ({ ready }) => useBootGate(ready, { minMs: 100, exitMs: 50, now: () => 0 }),
      { initialProps: { ready: false } },
    );

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.show).toBe(true);
    expect(result.current.exiting).toBe(false);

    rerender({ ready: true });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.exiting).toBe(true);
  });
});
