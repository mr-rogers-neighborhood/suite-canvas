import { DEFAULT_PALETTE } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SurfacePaintProvider } from "../canvas/surfaceContext";
import { ContextMenu } from "./ContextMenu";

function open() {
  render(
    <ContextMenu
      x={10}
      y={10}
      items={[
        { label: "Open" },
        { label: "Position", items: [{ label: "Above" }, { label: "Below" }] },
        { label: "Delete", danger: true },
      ]}
      onClose={() => {}}
    />,
  );
}

/**
 * The menu is portalled to `body` at the pointer, so Tab from the trigger went
 * to the end of the document. It has to take focus itself for the arrows its
 * role promises to arrive at all.
 */
describe("a context menu", () => {
  it("takes focus on its first item when it opens", () => {
    open();

    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("walks its own rows with the arrows", () => {
    open();
    const first = screen.getByRole("menuitem", { name: "Open" });
    const last = screen.getByRole("menuitem", { name: "Delete" });

    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
  });
});

/**
 * A menu's colour dots.
 *
 * The dark value used to sit in a custom property that nothing read, so every swatch in a menu was its daylight colour at
 * night: a colour picker that shows the wrong colour is worse than one that shows none.
 */
describe("a swatch in a menu", () => {
  const swatch = { light: "#111111", dark: "#eeeeee" };

  function draw(mode: "light" | "dark") {
    render(
      <SurfacePaintProvider.Provider value={{ palette: DEFAULT_PALETTE, roles: {}, mode }}>
        <ContextMenu
          x={0}
          y={0}
          items={[{ label: "Amber", swatch, onSelect: () => {} }]}
          onClose={() => {}}
        />
      </SurfacePaintProvider.Provider>,
    );
    return screen.getByTestId("menu-swatch");
  }

  it("should paint the daylight value in the light theme", () => {
    expect(draw("light").style.backgroundColor).toBe("rgb(17, 17, 17)");
  });

  it("should paint the night value in the dark theme", () => {
    expect(draw("dark").style.backgroundColor).toBe("rgb(238, 238, 238)");
  });
});
