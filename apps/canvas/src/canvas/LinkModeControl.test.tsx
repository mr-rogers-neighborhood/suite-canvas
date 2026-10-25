import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { LinkModeControl } from "./LinkModeControl";

beforeEach(() => {
  useUiStore.setState({ linkMode: "connect", canCreateContent: true });
});

afterEach(() => {
  fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
});

describe("LinkModeControl shift hint", () => {
  it("shows thread mode while Shift is held, without storing it", () => {
    render(<LinkModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");
    expect(toggle).toHaveAttribute("data-mode", "connect");
    expect(toggle).toHaveAttribute("data-hint-mode", "connect");
    expect(toggle).not.toHaveClass("is-thread");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });

    // The indicator mirrors the gesture the reader is making...
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");
    expect(toggle).toHaveClass("is-thread");
    // ...while the stored mode, and so what a click does, is untouched.
    expect(toggle).toHaveAttribute("data-mode", "connect");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(useUiStore.getState().linkMode).toBe("connect");

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });

    expect(toggle).toHaveAttribute("data-hint-mode", "connect");
    expect(toggle).not.toHaveClass("is-thread");
    expect(toggle).toHaveAttribute("data-mode", "connect");
  });

  it("stays in thread mode when Shift is released in thread mode", () => {
    useUiStore.setState({ linkMode: "thread" });
    render(<LinkModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");
    expect(toggle).toHaveAttribute("data-mode", "thread");
  });

  it("keeps the stored mode while another key is pressed with Shift", () => {
    render(<LinkModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    fireEvent.keyDown(window, { key: "t", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");

    // Releasing the letter is not releasing Shift.
    fireEvent.keyUp(window, { key: "t", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
    expect(toggle).toHaveAttribute("data-hint-mode", "connect");
  });

  it("drops the hint when the window loses focus", () => {
    render(<LinkModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");

    fireEvent.blur(window);
    expect(toggle).toHaveAttribute("data-hint-mode", "connect");
  });

  it("still toggles the stored mode on click", () => {
    render(<LinkModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("data-mode", "thread");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(useUiStore.getState().linkMode).toBe("thread");
  });
});
