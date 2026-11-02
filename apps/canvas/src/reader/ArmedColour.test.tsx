import type { AnnotationStyle } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArmedColour } from "./ArmedColour";

/**
 * Holding one colour.
 *
 * The value is in the second passage, not the first: a mode that saves a press once is not worth a mode. So the button
 * has to say which colour is held, and pressing it again has to be the way out.
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
  { id: "style-blue", name: "Claim", color: "#7aa2f7", order: 1 },
];

describe("holding a colour", () => {
  it("should say it is holding nothing, and offer the colours when pressed", () => {
    render(<ArmedColour styles={styles} armed={null} onArm={() => {}} />);
    const toggle = screen.getByTestId("reader-armed-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Hold a colour");

    fireEvent.click(toggle);
    expect(screen.getByRole("menuitem", { name: /Important/u })).toBeInTheDocument();
  });

  it("should hold the colour a reader picks", () => {
    const onArm = vi.fn();
    render(<ArmedColour styles={styles} armed={null} onArm={onArm} />);
    fireEvent.click(screen.getByTestId("reader-armed-toggle"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Claim/u }));
    expect(onArm).toHaveBeenCalledWith("style-blue");
  });

  it("should name the colour it is holding rather than opening the menu again", () => {
    const onArm = vi.fn();
    render(<ArmedColour styles={styles} armed="style-yellow" onArm={onArm} />);
    const toggle = screen.getByTestId("reader-armed-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Holding Important");

    fireEvent.click(toggle);
    expect(onArm).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});
