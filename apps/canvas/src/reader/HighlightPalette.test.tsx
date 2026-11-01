import type { AnnotationStyle } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HighlightPalette } from "./HighlightPalette";

/**
 * The four colours, where the words are.
 *
 * The palette used to be pinned to the bottom edge of the reader, so a reader who had just selected a sentence had to
 * find the buttons somewhere else on the screen. It is measured now, and the fallback stays for a surface that cannot
 * measure.
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
  { id: "style-blue", name: "Reference", color: "#4c8dff", order: 1 },
];

function draw(at?: { x: number; y: number }) {
  return render(
    <HighlightPalette
      styles={styles}
      anchor={{ quote: "The words." }}
      at={at}
      onPick={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
}

describe("the highlight palette", () => {
  it("should draw one button per kind, in palette order", () => {
    draw();
    expect(screen.getByTestId("highlight-style-yellow")).toBeInTheDocument();
    expect(screen.getByTestId("highlight-style-blue")).toBeInTheDocument();
  });

  it("should sit where the words are", () => {
    draw({ x: 120, y: 200 });
    const palette = screen.getByTestId("highlight-palette");

    expect(palette).toHaveAttribute("data-positioned", "true");
    expect(palette.style.left).toBe("120px");
    expect(palette.style.top).toBe("200px");
  });

  it("should fall back to the bottom edge when nothing measured it", () => {
    draw();
    const palette = screen.getByTestId("highlight-palette");

    // No inline point, and no `data-positioned`: the stylesheet's own placement is what applies.
    expect(palette).not.toHaveAttribute("data-positioned");
    expect(palette.style.left).toBe("");
    expect(palette.style.top).toBe("");
  });
});
