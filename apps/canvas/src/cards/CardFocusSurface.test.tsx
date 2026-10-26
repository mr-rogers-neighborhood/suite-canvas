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
