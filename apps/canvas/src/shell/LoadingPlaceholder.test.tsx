import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadingPlaceholder } from "./LoadingPlaceholder";

afterEach(() => {
  vi.useRealTimers();
});

describe("LoadingPlaceholder", () => {
  it("should name what is loading, so a slow chunk is not silence", () => {
    render(<LoadingPlaceholder label="Loading the rule editor" delayMs={0} />);

    const placeholder = screen.getByRole("status");
    expect(placeholder).toHaveAccessibleName("Loading the rule editor");
    expect(screen.getByText("Loading the rule editor")).toBeInTheDocument();
  });

  it("should hold a control's space in a row without shifting it", () => {
    render(<LoadingPlaceholder variant="inline" label="Loading workspace actions" delayMs={0} />);

    const placeholder = screen.getByTestId("loading-placeholder");
    expect(placeholder).toHaveAttribute("data-variant", "inline");
    // A row placeholder is the shape of the control it stands in for, so nothing
    // beside it moves when the chunk arrives.
    expect(screen.queryByText("Loading workspace actions")).toBeNull();
  });

  it("should stay out of the way while a fast chunk is still resolving", () => {
    vi.useFakeTimers();
    render(<LoadingPlaceholder label="Loading sign-in" />);

    expect(screen.queryByTestId("loading-placeholder")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByTestId("loading-placeholder")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByTestId("loading-placeholder")).toBeInTheDocument();
  });
});
