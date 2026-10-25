import { resolveSurfaceStyle } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  colourRoleVar,
  shapeClipPath,
  shapeRadius,
  sideAnimation,
  sideBorder,
  surfacePaintVars,
} from "./surfacePaint";

describe("surface paint", () => {
  it("names tokens, never values", () => {
    expect(colourRoleVar("accent")).toBe("var(--accent)");
    // A role is a meaning: the canvas role reads the canvas background token.
    expect(colourRoleVar("canvas")).toBe("var(--canvas-bg)");
    expect(colourRoleVar("surface-strong")).toBe("var(--surface-strong)");
    const paint = surfacePaintVars(resolveSurfaceStyle({ surface: "accent" }, "card"));
    expect(paint["--paint-surface"]).toBe("var(--accent)");
    expect(paint["--paint-ink"]).toBe("var(--ink)");
  });

  it("paints nothing when the surface is seamless, but keeps it visible to a hover", () => {
    const paint = surfacePaintVars(resolveSurfaceStyle({ surface: "none" }, "section"));
    expect(paint["--paint-surface"]).toBe("transparent");
    // Opacity is still full: seamless is not invisible.
    expect(paint["--paint-opacity"]).toBe("1");
  });

  it("clips a silhouette rather than reshaping the box", () => {
    expect(shapeClipPath("diamond")).toContain("polygon");
    expect(shapeClipPath("rect")).toBeUndefined();
    expect(shapeRadius("pill")).toBe("999px");
    expect(shapeRadius("circle")).toBe("50%");
    const paint = surfacePaintVars(resolveSurfaceStyle({ shape: "diamond" }, "card"));
    expect(paint["--paint-clip"]).toContain("polygon");
  });

  it("honours a radius the style names over the shape default", () => {
    const paint = surfacePaintVars(resolveSurfaceStyle({ radius: 18 }, "card"));
    expect(paint["--paint-radius"]).toBe("18px");
  });

  it("writes only the sides a style names, and can remove one", () => {
    const styled = resolveSurfaceStyle(
      { sides: { top: { paint: "dashed", width: 2, colour: "accent" } } },
      "card",
    );
    const paint = surfacePaintVars(styled);
    expect(paint["--paint-border-top"]).toBe("2px dashed var(--accent)");
    expect(paint["--paint-border-left"]).toBeUndefined();

    const removed = resolveSurfaceStyle({ sides: { bottom: { paint: "none" } } }, "card");
    expect(surfacePaintVars(removed)["--paint-border-bottom"]).toBe("none");
  });

  it("animates a dashed edge in the direction the geometry gives it", () => {
    const forward = resolveSurfaceStyle(
      { sides: { right: { paint: "solid" }, bottom: { paint: "dashed", flow: "forward" } } },
      "card",
    );
    // A solid edge never animates, however it is asked to.
    expect(sideAnimation(forward, "right")).toBeUndefined();
    expect(sideAnimation(forward, "bottom")).toBe("bottom-dash 4s linear infinite");
    expect(sideBorder(forward, "right")).toBe("1px solid var(--ink)");

    const reversed = resolveSurfaceStyle(
      { sides: { bottom: { paint: "dotted", flow: "reverse", speed: 6 } } },
      "card",
    );
    expect(sideAnimation(reversed, "bottom")).toBe("bottom-dash 6s linear infinite reverse");
  });

  it("keeps an unstyled surface untouched", () => {
    expect(surfacePaintVars(undefined)).toEqual({});
  });
});
