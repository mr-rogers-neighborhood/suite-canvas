import { fireEvent, render, screen } from "@testing-library/react";
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
  it("walks explore → run → record → present → explore on repeated clicks", () => {
    // A tour is what makes `present` reachable; the store refuses it otherwise.
    useUiStore.setState({ tour });
    render(<PurposeControl />);

    expect(toggle()).toHaveAttribute("data-purpose", "explore");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("data-purpose", "run");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("data-purpose", "record");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("data-purpose", "present");
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("data-purpose", "explore");
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(useUiStore.getState().purpose).toBe("explore");
  });
});

describe("PurposeControl refuses a tour that does not exist", () => {
  it("looks disabled and says why when present is next, and skips it on click", () => {
    useUiStore.setState({ purpose: "record", tour: null });
    render(<PurposeControl />);

    expect(toggle()).toHaveAttribute("data-purpose", "record");
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
    expect(toggle()).toHaveAttribute("title", expect.stringContaining("Nothing to present yet"));

    fireEvent.click(toggle());

    // The unavailable value is passed over rather than stalled on: leaving the
    // purpose that claimed the clicks is the exit ADR-0064 §10 requires.
    expect(useUiStore.getState().purpose).toBe("explore");
    expect(toggle()).not.toHaveAttribute("aria-disabled");
  });

  it("enters present once a tour exists", () => {
    useUiStore.setState({ purpose: "record", tour });
    render(<PurposeControl />);

    expect(toggle()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("data-purpose", "present");
    expect(useUiStore.getState().purpose).toBe("present");
  });

  it("says the tour has ended when presenting outlives its tour", () => {
    useUiStore.setState({ purpose: "present", tour: null });
    render(<PurposeControl />);

    // The reader is on a value with nothing behind it, so leaving is the one move
    // left — and the control must not swallow it.
    expect(toggle()).not.toHaveAttribute("aria-disabled");
    expect(toggle()).toHaveAttribute("title", expect.stringContaining("The tour has ended"));

    fireEvent.click(toggle());
    expect(useUiStore.getState().purpose).toBe("explore");
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

  it("keeps the glyph and the label for every state", () => {
    const labels = [
      "Explore mode: edit the canvas",
      "Run mode: place a sequence of cards",
      "Record mode: capture steps into a tour",
      "Present mode: show the tour",
    ];
    useUiStore.setState({ tour });
    render(<PurposeControl />);

    const glyphs = new Set<string>();
    for (const label of labels) {
      expect(toggle().getAttribute("aria-label")).toContain(label);
      // Hue is never the only signal: every state carries a glyph of its own.
      glyphs.add(toggle().textContent ?? "");
      fireEvent.click(toggle());
    }

    expect(glyphs.size).toBe(4);
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
