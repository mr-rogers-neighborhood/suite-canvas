import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../store/useUiStore";
import { ModeControl } from "./ModeControl";

/** The link tool is one cycling button: a glyph now, the next mode in its title. */
describe("the link tool", () => {
  beforeEach(() => {
    useUiStore.setState({ mode: "place", canManageLinks: true });
  });

  it("is one button showing the glyph of the mode in force", () => {
    render(<ModeControl />);

    expect(screen.getByTestId("link-mode-toggle")).toHaveAttribute("data-mode", "place");
    expect(screen.getByTestId("link-mode-glyph").textContent).toBe("\u2194");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("cycles place to thread to fan and back in one press each", () => {
    render(<ModeControl />);
    const button = screen.getByTestId("link-mode-toggle");

    fireEvent.click(button);
    expect(useUiStore.getState().mode).toBe("thread");
    expect(screen.getByTestId("link-mode-glyph").textContent).toBe("\u2933");

    fireEvent.click(button);
    expect(useUiStore.getState().mode).toBe("fan");

    fireEvent.click(button);
    expect(useUiStore.getState().mode).toBe("place");
  });

  it("says what the mode in force does and what the next click chooses", () => {
    render(<ModeControl />);
    const button = screen.getByTestId("link-mode-toggle");

    expect(button).toHaveAttribute("aria-label", expect.stringContaining("Place mode"));
    expect(button).toHaveAttribute("title", expect.stringContaining("thread mode"));
  });

  it("is absent for a viewer, who cannot draw links", () => {
    useUiStore.setState({ canManageLinks: false });
    render(<ModeControl />);
    expect(screen.queryByTestId("link-mode-toggle")).toBeNull();
  });
});
