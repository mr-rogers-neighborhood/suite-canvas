import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnnouncerForTests } from "./announcer";
import { ToastLayer } from "./ToastLayer";
import { toast, useToastStore } from "./toast";

beforeEach(() => {
  useToastStore.getState().clear();
  resetAnnouncerForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastLayer", () => {
  it("should render nothing while there is nothing to say", () => {
    render(<ToastLayer />);
    expect(screen.queryByTestId("toast-layer")).toBeNull();
  });

  it("should show the three tones as one named region", () => {
    render(<ToastLayer />);
    act(() => {
      toast.success("Export ready");
      toast.failure("Could not copy diagnostics");
      toast.neutral("Card moved to Inbox");
    });

    const layer = screen.getByTestId("toast-layer");
    // A named `section` is a region landmark: one place to look for what the app
    // said, without a second live region competing with `LiveRegion`.
    expect(layer.tagName).toBe("SECTION");
    expect(layer).toHaveAccessibleName("Notifications");
    expect(screen.getByTestId("toast-success")).toHaveTextContent("Export ready");
    expect(screen.getByTestId("toast-failure")).toHaveTextContent("Could not copy diagnostics");
    expect(screen.getByTestId("toast-neutral")).toHaveTextContent("Card moved to Inbox");
  });

  it("should dismiss on its own button", () => {
    render(<ToastLayer />);
    act(() => {
      toast.success("Export ready");
    });

    fireEvent.click(screen.getByTestId("toast-dismiss"));
    expect(screen.queryByTestId("toast-layer")).toBeNull();
  });

  it("should run the action and dismiss the toast that carried it", () => {
    const onAction = vi.fn();
    render(<ToastLayer />);
    act(() => {
      toast.failure("This device is out of storage", {
        action: { label: "Export a copy", onAction },
      });
    });

    fireEvent.click(screen.getByTestId("toast-action"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("toast-layer")).toBeNull();
  });

  it("should dismiss itself after the lifetime it was given", () => {
    vi.useFakeTimers();
    render(<ToastLayer />);
    act(() => {
      toast.success("Export ready", { timeout: 1000 });
    });

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByTestId("toast-layer")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.queryByTestId("toast-layer")).toBeNull();
  });

  /** A toast that vanishes from under the pointer reaching for it is a bug. */
  it("should pause the clock while the pointer is over it", () => {
    vi.useFakeTimers();
    render(<ToastLayer />);
    act(() => {
      toast.success("Export ready", { timeout: 1000 });
    });

    const item = screen.getByTestId("toast-success");
    fireEvent.pointerEnter(item);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("toast-success")).toBeInTheDocument();

    fireEvent.pointerLeave(item);
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.queryByTestId("toast-layer")).toBeNull();
  });

  it("should pause while the keyboard is inside it, so the dismiss button stays reachable", () => {
    vi.useFakeTimers();
    render(<ToastLayer />);
    act(() => {
      toast.success("Export ready", { timeout: 1000 });
    });

    const dismiss = screen.getByTestId("toast-dismiss");
    act(() => {
      dismiss.focus();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("toast-dismiss")).toBeInTheDocument();
  });

  it("should not take focus when it arrives", () => {
    render(<ToastLayer />);
    act(() => {
      toast.failure("This device is out of storage");
    });

    expect(document.activeElement).toBe(document.body);
  });

  it("should keep a toast until it is dismissed when its timeout is null", () => {
    vi.useFakeTimers();
    render(<ToastLayer />);
    act(() => {
      toast.neutral("Exporting…", { timeout: null });
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("toast-neutral")).toBeInTheDocument();
  });
});
