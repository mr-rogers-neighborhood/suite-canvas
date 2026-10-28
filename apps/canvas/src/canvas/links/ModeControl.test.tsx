import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../store/useUiStore";
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
    expect(toggle).not.toHaveAttribute("data-preview");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });

    // The indicator mirrors the gesture the reader is making...
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");
    expect(toggle).toHaveAttribute("data-preview", "thread");
    // ...while the stored mode, and so what a click does, is untouched.
    expect(toggle).toHaveAttribute("data-mode", "place");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(useUiStore.getState().mode).toBe("place");

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });

    expect(toggle).toHaveAttribute("data-hint-mode", "place");
    expect(toggle).not.toHaveAttribute("data-preview");
    expect(toggle).toHaveAttribute("data-mode", "place");
  });

  it("hands back the mode a key displaced, and returns to it on release", () => {
    useUiStore.setState({ mode: "thread" });
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    // Shift is what put the reader in thread, so holding it cannot mean "thread"
    // again: it shows what thread replaced, which is the only non-redundant answer.
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "place");
    expect(toggle).toHaveAttribute("title", expect.stringContaining("to return to Thread"));

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
    expect(toggle).toHaveAttribute("data-hint-mode", "thread");
    expect(toggle).toHaveAttribute("data-mode", "thread");
  });

  it("hands back the baseline for every key whose value is already stored", () => {
    // The baseline and not the previous value: stepping back made ctrl show `thread`
    // from `fan`, which shift was already showing, leaving `place` unreachable. The
    // full matrix lives in `modifierPreview.test.ts`; this asserts the control paints
    // what the map says for the collision case in each slot.
    const cases = [
      { mode: "thread", key: "Shift", shiftKey: true, expect: "place" },
      { mode: "fan", key: "Control", ctrlKey: true, expect: "place" },
    ] as const;

    for (const { mode, key, expect: previewed, ...held } of cases) {
      useUiStore.setState({ mode });
      const { unmount } = render(<ModeControl />);
      const toggle = screen.getByTestId("link-mode-toggle");

      fireEvent.keyDown(window, { key, ...held });
      expect(toggle).toHaveAttribute("data-hint-mode", previewed);

      fireEvent.keyUp(window, { key, shiftKey: false, ctrlKey: false, altKey: false });
      expect(toggle).toHaveAttribute("data-hint-mode", mode);
      unmount();
    }
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

  it("refuses the click while a modifier is held, and says so instead of promising a switch", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    // Ctrl from place shows fan. Clicking used to cycle *from place* — committing
    // thread while the button showed fan — so the guard is what keeps the glyph and
    // the stored mode from disagreeing.
    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "fan");
    expect(toggle).toHaveAttribute("title", expect.stringContaining("Release Ctrl"));

    fireEvent.click(toggle);
    expect(useUiStore.getState().mode).toBe("place");

    // Release ends the override at the mode the reader last clicked.
    fireEvent.keyUp(window, { key: "Control", ctrlKey: false });
    expect(toggle).toHaveAttribute("data-mode", "place");
    expect(toggle).toHaveAttribute("data-hint-mode", "place");
    expect(toggle).toHaveAttribute("title", expect.stringContaining("Switch to thread mode"));
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
  it("walks place → thread → fan → place on repeated clicks", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    expect(toggle).toHaveAttribute("data-mode", "place");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-mode", "thread");
    // A committed mode is `data-mode`; `data-preview` exists only while a key is held,
    // so the two can never disagree about which value is painted.
    expect(toggle).not.toHaveAttribute("data-preview");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("data-mode", "fan");
    expect(toggle).not.toHaveAttribute("data-preview");
    fireEvent.click(toggle);
    // Back to the resting tool, and the store agrees with the paint.
    expect(toggle).toHaveAttribute("data-mode", "place");
    expect(toggle).not.toHaveAttribute("data-preview");
    expect(useUiStore.getState().mode).toBe("place");
  });

  it("previews fan mode while Control is held", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "fan");
    expect(toggle).toHaveAttribute("data-hint", "true");
    expect(toggle).toHaveAttribute("data-preview", "fan");
    expect(toggle).toHaveAttribute("data-mode", "place");

    fireEvent.keyUp(window, { key: "Control", ctrlKey: false });
    expect(toggle).toHaveAttribute("data-hint-mode", "place");
    expect(toggle).not.toHaveAttribute("data-preview");
  });

  it("prefers fan over thread when Control and Shift are both held", () => {
    render(<ModeControl />);
    const toggle = screen.getByTestId("link-mode-toggle");

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true, ctrlKey: true });
    expect(toggle).toHaveAttribute("data-hint-mode", "fan");
    expect(toggle).toHaveAttribute("data-preview", "fan");
  });

  it("disarms a pending origin when the mode changes", () => {
    useLinkThreadStore.setState({
      armed: { kind: "card", id: "a", connectorId: "a1" },
      armedBy: "gesture",
    });
    render(<ModeControl />);

    fireEvent.click(screen.getByTestId("link-mode-toggle"));

    // An origin armed for a fan means a different graph once the mode is thread.
    expect(useLinkThreadStore.getState().armed).toBeNull();
  });
});
