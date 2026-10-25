import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { useLinkThreadStore } from "./linkThread";
import { ModeControl } from "./ModeControl";

beforeEach(() => {
  useUiStore.setState({ mode: "place", canCreateContent: true });
});

afterEach(() => {
  fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
  fireEvent.keyUp(window, { key: "Control", ctrlKey: false });
});

describe("ModeControl shift hint", () => {
  it("shows thread mode while Shift is held, without storing it", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");
    expect(toggle).toHaveAttribute("data-mode", "place");
    expect(toggle).toHaveAttribute("data-hint-mode", "place");
    expect(toggle).not.toHaveClass("is-thread");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });

    // The indicator mirrors the gesture the reader is making...
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");
    expect(toggle).toHaveClass("is-thread");
    // ...while the stored mode, and so what a click does, is untouched.
    expect(toggle).toHaveAttribute("data-mode", "place");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(useUiStore.getState().mode).toBe("place");

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });

    expect(toggle).toHaveAttribute("data-hint-mode", "place");
    expect(toggle).not.toHaveClass("is-thread");
    expect(toggle).toHaveAttribute("data-mode", "place");
  });

  it("stays in thread mode when Shift is released in thread mode", () => {
    useUiStore.setState({ mode: "thread" });
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");
    expect(toggle).toHaveAttribute("data-mode", "thread");
  });

  it("keeps the stored mode while another key is pressed with Shift", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    fireEvent.keyDown(window, { key: "t", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");

    // Releasing the letter is not releasing Shift.
    fireEvent.keyUp(window, { key: "t", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
    expect(toggle).toHaveAttribute("data-hint-mode", "place");
  });

  it("drops the hint when the window loses focus", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");

    fireEvent.blur(window);
    expect(toggle).toHaveAttribute("data-hint-mode", "place");
  });

  it("still toggles the stored mode on click", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("data-mode", "thread");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(useUiStore.getState().mode).toBe("thread");
  });
});

describe("ModeControl three-state cycle", () => {
  it("walks place → thread → web → pattern → place on repeated clicks", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    expect(toggle).toHaveAttribute("data-mode", "place");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-mode", "thread");
    expect(toggle).toHaveClass("is-thread");
    expect(toggle).not.toHaveClass("is-web");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-mode", "web");
    expect(toggle).toHaveClass("is-web");
    expect(toggle).not.toHaveClass("is-thread");
    fireEvent.click(toggle);
    // The fourth shape: a chain that branches. See ADR-0063.
    expect(toggle).toHaveAttribute("data-mode", "pattern");
    expect(toggle).toHaveClass("is-pattern");
    expect(toggle).not.toHaveClass("is-web");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-mode", "place");

    expect(useUiStore.getState().mode).toBe("place");
  });

  it("previews web mode while Control is held", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "web");
    expect(toggle).toHaveAttribute("data-hint", "true");
    expect(toggle).toHaveClass("is-web");
    expect(toggle).toHaveAttribute("data-mode", "place");

    fireEvent.keyUp(window, { key: "Control", ctrlKey: false });
    expect(toggle).toHaveAttribute("data-hint-mode", "place");
    expect(toggle).not.toHaveClass("is-web");
  });

  it("prefers web over thread when Control and Shift are both held", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true, ctrlKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "web");
    expect(toggle).toHaveClass("is-web");
    expect(toggle).not.toHaveClass("is-thread");
  });

  it("disarms a pending origin when the mode changes", () => {
    useLinkThreadStore.setState({
      armed: { kind: "card", id: "a", connectorId: "a1" },
      armedBy: "gesture",
    });
    render(<ModeControl />);

    fireEvent.click(screen.getByTestId("link-mode-toggle"));

    // An origin armed for a web means a different graph once the mode is thread.
    expect(useLinkThreadStore.getState().armed).toBeNull();
  });
});
