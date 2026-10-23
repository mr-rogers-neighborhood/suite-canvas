import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_DELAY_MS, HOLD_INTERVAL_MS, useHoldRepeat } from "./useHoldRepeat";

afterEach(() => {
  vi.useRealTimers();
});

function Button({ action }: { action: (repeat: number) => void }) {
  const handlers = useHoldRepeat(action);
  return createElement("button", { type: "button", "data-testid": "hold", ...handlers }, "hold");
}

describe("useHoldRepeat", () => {
  it("steps immediately, then repeats after the hold delay", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    render(createElement(Button, { action }));
    const button = screen.getByTestId("hold");

    fireEvent.pointerDown(button, { button: 0 });
    expect(action).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS - 1));
    expect(action).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1 + HOLD_INTERVAL_MS));
    expect(action).toHaveBeenCalledTimes(2);
    // The count is how deep into the hold this step is, so the action can accelerate.
    expect(action.mock.calls.map(([repeat]) => repeat)).toEqual([0, 1]);
  });

  it("keeps repeating at the interval while held", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    render(createElement(Button, { action }));
    fireEvent.pointerDown(screen.getByTestId("hold"), { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_INTERVAL_MS * 10));
    // 1 immediate + the delay + ten intervals (the last may land on the edge).
    expect(action.mock.calls.length).toBeGreaterThanOrEqual(11);
  });

  it("stops on release, leave and cancel", () => {
    for (const stop of ["pointerUp", "pointerLeave", "pointerCancel"] as const) {
      vi.useFakeTimers();
      const action = vi.fn();
      const { unmount } = render(createElement(Button, { action }));
      const button = screen.getByTestId("hold");
      fireEvent.pointerDown(button, { button: 0 });
      act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_INTERVAL_MS));
      fireEvent[stop](button);
      const atStop = action.mock.calls.length;
      act(() => vi.advanceTimersByTime(HOLD_INTERVAL_MS * 10));
      expect(action).toHaveBeenCalledTimes(atStop);
      unmount();
      vi.useRealTimers();
    }
  });

  it("ignores a secondary button", () => {
    const action = vi.fn();
    render(createElement(Button, { action }));
    fireEvent.pointerDown(screen.getByTestId("hold"), { button: 2 });
    expect(action).not.toHaveBeenCalled();
  });

  it("steps once for a keyboard click and claims pointer clicks", () => {
    const action = vi.fn();
    render(createElement(Button, { action }));
    fireEvent.click(screen.getByTestId("hold"), { detail: 0 });
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("hold"), { detail: 1 });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("clears pending timers when unmounted mid-hold", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const { unmount } = render(createElement(Button, { action }));
    fireEvent.pointerDown(screen.getByTestId("hold"), { button: 0 });
    unmount();
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_INTERVAL_MS * 5));
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("useHoldRepeat defaults", () => {
  it("exposes the documented delay and interval", () => {
    expect(HOLD_DELAY_MS).toBe(260);
    expect(HOLD_INTERVAL_MS).toBe(70);
  });
});
