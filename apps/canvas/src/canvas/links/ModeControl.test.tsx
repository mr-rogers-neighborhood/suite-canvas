import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../store/useUiStore";
import { ModeControl } from "./ModeControl";

/** The link tool is three segments, and the active one says so. */
describe("the link tool", () => {
  beforeEach(() => {
    useUiStore.setState({ mode: "place", canManageLinks: true });
  });

  it("offers one segment per mode and marks the one in force", () => {
    render(<ModeControl />);

    expect(screen.getByTestId("link-mode-place")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("link-mode-thread")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("link-mode-fan")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("link-mode-place").textContent).toBe("Place");
  });

  it("sets the mode on a click, in one press", () => {
    render(<ModeControl />);

    fireEvent.click(screen.getByTestId("link-mode-fan"));

    expect(useUiStore.getState().mode).toBe("fan");
    expect(screen.getByTestId("link-mode-fan")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("link-mode-place")).toHaveAttribute("aria-pressed", "false");
  });

  it("says what each mode does, so the labels need no legend", () => {
    render(<ModeControl />);

    expect(screen.getByTestId("link-mode-thread")).toHaveAttribute(
      "title",
      expect.stringContaining("chains"),
    );
    expect(screen.getByTestId("link-mode-fan")).toHaveAttribute(
      "title",
      expect.stringContaining("same origin"),
    );
  });

  it("is absent for a viewer, who cannot draw links", () => {
    useUiStore.setState({ canManageLinks: false });
    render(<ModeControl />);
    expect(screen.queryByTestId("link-mode-toggle")).toBeNull();
  });
});
