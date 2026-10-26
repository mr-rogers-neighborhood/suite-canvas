import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardFocusSurface } from "./CardFocusSurface";

describe("CardFocusSurface", () => {
  it("should render its card content with a labelled surface", () => {
    render(
      <CardFocusSurface title="Onboarding" onClose={() => {}}>
        <p>body</p>
      </CardFocusSurface>,
    );

    const surface = screen.getByTestId("card-focus");
    expect(surface).toHaveAttribute("aria-label", "Focused card: Onboarding");
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("should close from the back button, the close button and Escape", () => {
    const onClose = vi.fn();
    render(
      <CardFocusSurface title="Onboarding" onClose={onClose}>
        <button type="button">a control</button>
      </CardFocusSurface>,
    );

    fireEvent.click(screen.getByTestId("card-focus-back"));
    fireEvent.click(screen.getByTestId("card-focus-close"));
    // Escape bubbles from a control inside the surface.
    fireEvent.keyDown(screen.getByRole("button", { name: "a control" }), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("should keep room for the inspector while it is open", () => {
    render(
      <CardFocusSurface title="Onboarding" onClose={() => {}} insetRight={344}>
        <p>body</p>
      </CardFocusSurface>,
    );
    expect(screen.getByTestId("card-focus")).toHaveStyle({ paddingRight: "344px" });
  });
});

/**
 * Focus mode is a modal for the board: the card covers the canvas, so Tab must
 * not walk onto the cards behind it, and a sketch needs the keyboard.
 */
describe("CardFocusSurface as a dialog", () => {
  it("announces itself as a modal dialog", () => {
    render(
      <CardFocusSurface title="Onboarding" onClose={() => {}}>
        <p>body</p>
      </CardFocusSurface>,
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("takes focus and keeps Tab inside the sheet", () => {
    render(
      <CardFocusSurface title="Onboarding" onClose={() => {}}>
        <button type="button">last control</button>
      </CardFocusSurface>,
    );
    const surface = screen.getByTestId("card-focus");
    const last = screen.getByRole("button", { name: "last control" });

    expect(surface.contains(document.activeElement)).toBe(true);
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });

    expect(surface.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });

  it("puts a sketch's drawing surface in focus, because it listens for keys", () => {
    render(
      <CardFocusSurface title="Sketch" onClose={() => {}}>
        <div data-testid="sketch-focus">
          {/* Excalidraw's own container is a focusable div; the test mirrors it. */}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the drawing surface is where a sketch answers keys. */}
          <div data-testid="drawing-surface" tabIndex={0} />
        </div>
      </CardFocusSurface>,
    );

    expect(screen.getByTestId("drawing-surface")).toHaveFocus();
  });

  it("focuses the sketch container itself when it holds no focusable child", () => {
    render(
      <CardFocusSurface title="Sketch" onClose={() => {}}>
        <div data-testid="sketch-focus">
          <p>Loading sketch…</p>
        </div>
      </CardFocusSurface>,
    );

    const sketch = screen.getByTestId("sketch-focus");
    expect(sketch).toHaveFocus();
    expect(sketch).toHaveAttribute("tabindex", "-1");
  });
});
