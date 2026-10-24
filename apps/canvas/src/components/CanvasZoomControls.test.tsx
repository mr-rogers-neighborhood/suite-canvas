import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasZoomControls, holdZoomFactor } from "./CanvasZoomControls";
import { HOLD_DELAY_MS, HOLD_INTERVAL_MS } from "./useHoldRepeat";

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function mount(overrides: Partial<Parameters<typeof CanvasZoomControls>[0]> = {}) {
  const handlers = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitView: vi.fn(),
    onTypes: vi.fn(),
  };
  render(<CanvasZoomControls {...handlers} {...overrides} />);
  return handlers;
}

describe("CanvasZoomControls", () => {
  it("should render the zoom cluster as a labelled toolbar", () => {
    mount();
    const toolbar = screen.getByTestId("canvas-controls");
    expect(toolbar).toHaveAttribute("role", "toolbar");
    expect(toolbar).toHaveAttribute("aria-label", "Canvas zoom");
    expect(toolbar).toHaveAttribute("aria-orientation", "vertical");
  });

  it("should report each camera action once", () => {
    const handlers = mount();
    fireEvent.click(screen.getByTestId("canvas-zoom-in"));
    fireEvent.click(screen.getByTestId("canvas-zoom-out"));
    fireEvent.click(screen.getByTestId("canvas-zoom-fit"));
    fireEvent.click(screen.getByTestId("canvas-types"));
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onFitView).toHaveBeenCalledTimes(1);
    expect(handlers.onTypes).toHaveBeenCalledTimes(1);
  });

  it("should repeat while a zoom button is held and stop on release", () => {
    vi.useFakeTimers();
    try {
      const handlers = mount();
      const button = screen.getByTestId("canvas-zoom-in");
      fireEvent.pointerDown(button, { button: 0 });
      // The first step is immediate: a click never feels late.
      expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
      expect(handlers.onZoomIn).toHaveBeenCalledWith(1.25);
      act(() => {
        vi.advanceTimersByTime(HOLD_DELAY_MS - 10);
      });
      expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(10);
      });
      expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(HOLD_INTERVAL_MS);
      });
      expect(handlers.onZoomIn).toHaveBeenCalledTimes(2);
      act(() => {
        vi.advanceTimersByTime(HOLD_INTERVAL_MS * 3);
      });
      expect(handlers.onZoomIn.mock.calls.length).toBeGreaterThan(3);

      fireEvent.pointerUp(button);
      const whileHeld = handlers.onZoomIn.mock.calls.length;
      act(() => {
        vi.advanceTimersByTime(HOLD_INTERVAL_MS * 5);
      });
      expect(handlers.onZoomIn).toHaveBeenCalledTimes(whileHeld);
      // The pointer-generated click that follows a press must not step twice.
      fireEvent.click(button, { detail: 1 });
      expect(handlers.onZoomIn).toHaveBeenCalledTimes(whileHeld);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should still step once for a keyboard click", () => {
    const handlers = mount();
    fireEvent.click(screen.getByTestId("canvas-zoom-out"));
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledWith(1 / 1.25);
  });

  it("should accelerate the step while held, so a hold traverses the extent", () => {
    expect(holdZoomFactor(0)).toBe(1.25);
    expect(holdZoomFactor(1)).toBe(1.25);
    let previous = holdZoomFactor(1);
    for (let repeat = 2; repeat <= 40; repeat += 1) {
      const factor = holdZoomFactor(repeat);
      expect(factor).toBeGreaterThanOrEqual(previous);
      previous = factor;
    }
    // Capped: a long hold stays controllable rather than exploding.
    expect(holdZoomFactor(1000)).toBeLessThanOrEqual(1.8);
  });

  it("should always offer the types control, even on an empty View", () => {
    mount();
    const types = screen.getByTestId("canvas-types");
    expect(types).toHaveAttribute("aria-label", "Types");
    expect(screen.getByTestId("canvas-zoom-in")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-zoom-fit")).toBeInTheDocument();
  });
});
