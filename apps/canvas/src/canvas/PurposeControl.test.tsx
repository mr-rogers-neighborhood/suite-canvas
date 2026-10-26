import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { PurposeControl } from "./PurposeControl";

const tour = {
  tutorialId: "tutorial-1",
  stepIndex: 0,
  presenting: false,
  panelOpen: true,
};

const toggle = () => screen.getByTestId("purpose-toggle");

beforeEach(() => {
  useUiStore.setState({ purpose: "explore", tour: null });
});

describe("PurposeControl cycle", () => {
  it("walks explore → run → record → explore on repeated clicks", () => {
    render(<PurposeControl />);

    expect(toggle()).toHaveAttribute("data-purpose", "explore");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("data-purpose", "run");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("data-purpose", "record");
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("data-purpose", "explore");
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(useUiStore.getState().purpose).toBe("explore");
  });

  it("never walks into present, even with a tour open and ready", () => {
    useUiStore.setState({ tour });
    render(<PurposeControl />);

    // Three clicks is a full lap of the cycle. A presentation is scoped to a tour
    // and only a tour can start one (§11), so the widget must not offer it however
    // available it looks.
    for (let click = 0; click < 3; click += 1) {
      expect(toggle()).not.toHaveAttribute("data-purpose", "present");
      fireEvent.click(toggle());
    }

    expect(toggle()).toHaveAttribute("data-purpose", "explore");
  });

  it("leaves a presentation when a tour puts it there, without closing the tour", () => {
    useUiStore.setState({ tour: { ...tour, presenting: true }, purpose: "present" });
    render(<PurposeControl />);

    expect(toggle()).toHaveAttribute("data-purpose", "present");
    expect(toggle()).toHaveAttribute("title", expect.stringContaining("Stop presenting"));

    fireEvent.click(toggle());

    // Back to editing, but the tour is still open: Escape is the way to close it.
    expect(useUiStore.getState().purpose).toBe("explore");
    expect(useUiStore.getState().tour).not.toBeNull();
    expect(useUiStore.getState().tour?.presenting).toBe(false);
  });
});

describe("PurposeControl labels", () => {
  it("names the mode it is in and the mode a click would enter", () => {
    render(<PurposeControl />);

    expect(toggle()).toHaveAttribute(
      "aria-label",
      "Explore mode: edit the canvas. Switch to run mode: place a sequence of cards",
    );
    expect(toggle()).toHaveAttribute(
      "title",
      "Explore mode: edit the canvas. Switch to run mode: place a sequence of cards",
    );
  });

  it("keeps a glyph for every state, and none of them is a play triangle", () => {
    useUiStore.setState({ tour: { ...tour, presenting: true }, purpose: "record" });
    render(<PurposeControl />);

    const glyphs = new Set<string>();
    for (let state = 0; state < 3; state += 1) {
      glyphs.add(toggle().textContent ?? "");
      fireEvent.click(toggle());
    }

    // Ray is a queue of cards, not media playback: a triangle beside a record dot
    // reads as transport controls, and §11 is why it is gone.
    expect([...glyphs]).not.toContain("\u25b6");
    expect(glyphs.size).toBe(3);

    // Presenting has its own glyph, shown when a tour is up.
    act(() => useUiStore.setState({ purpose: "present" }));
    expect(toggle().textContent).toBe("\u25a3");
  });
});

describe("PurposeControl modifier preview", () => {
  it("previews run on shift and record on ctrl, without storing either", () => {
    render(<PurposeControl />);

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(toggle()).toHaveAttribute("data-preview", "run");
    expect(toggle()).not.toHaveAttribute("data-purpose", "run");
    expect(toggle()).toHaveAttribute("title", expect.stringContaining("run mode"));

    fireEvent.keyDown(window, { key: "Control", shiftKey: false, ctrlKey: true });
    expect(toggle()).toHaveAttribute("data-preview", "record");

    fireEvent.keyUp(window, { key: "Control", ctrlKey: false });
    expect(toggle()).not.toHaveAttribute("data-preview");
    // Nothing was stored: a preview is paint, and the axis is where it was.
    expect(useUiStore.getState().purpose).toBe("explore");
  });

  it("commits the previewed value when the control is clicked with the modifier held", () => {
    render(<PurposeControl />);

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    fireEvent.click(toggle());

    // A shortcut, not a cycle step: holding shift and clicking means run.
    expect(useUiStore.getState().purpose).toBe("run");
  });

  it("previews explain on alt, and refuses the click because that mode is not built", () => {
    render(<PurposeControl />);

    fireEvent.keyDown(window, { key: "Alt", altKey: true });

    // The fourth colour exists (purple, gate A41) and the preview shows it...
    expect(toggle()).toHaveAttribute("data-preview", "explain");
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
    expect(toggle()).toHaveAttribute("title", expect.stringContaining("not built"));

    // ...but a click does not commit a mode that does nothing, which is what keeps
    // the preview paint rather than a promise.
    fireEvent.click(toggle());
    expect(useUiStore.getState().purpose).toBe("explore");

    fireEvent.keyUp(window, { key: "Alt", altKey: false });
  });

  it("is not previewed while the reader is typing in a card", () => {
    render(<PurposeControl />);
    const field = document.createElement("div");
    field.className = "ProseMirror";
    document.body.append(field);

    fireEvent.keyDown(field, { key: "Shift", shiftKey: true, bubbles: true });

    // A capital letter is not a mode.
    expect(toggle()).not.toHaveAttribute("data-preview");
    field.remove();
  });
});

describe("PurposeControl pointer events", () => {
  it("does not let pointerdown reach the canvas beneath it", () => {
    const onPointerDown = vi.fn();
    const onPointerUp = vi.fn();
    render(
      <div onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <PurposeControl />
      </div>,
    );

    fireEvent.pointerDown(toggle());
    fireEvent.pointerUp(toggle());

    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onPointerUp).not.toHaveBeenCalled();
  });
});
