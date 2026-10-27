import { describe, expect, it } from "vitest";
import {
  CONTRAST_FLOOR,
  clampStyle,
  defaultEdgeFlow,
  isEmptyStyle,
  OPACITY_FLOOR,
  pickInk,
  resolveSurfaceStyle,
  surfaceStyleSchema,
  TEXT_SCALE_MAX,
} from "./style.js";

describe("surface styles", () => {
  it("resolves a default per surface without inventing a colour value", () => {
    expect(resolveSurfaceStyle(undefined, "card").surface).toBe("surface");
    expect(resolveSurfaceStyle(undefined, "board").surface).toBe("canvas");
    expect(resolveSurfaceStyle(undefined, "link")).toMatchObject({
      surface: "none",
      ink: "accent",
    });
    expect(resolveSurfaceStyle(undefined, "card").textScale).toBe(1);
  });

  it("takes the stored record over the default, field by field", () => {
    const resolved = resolveSurfaceStyle({ surface: "accent", shape: "pill" }, "card");
    expect(resolved.surface).toBe("accent");
    expect(resolved.shape).toBe("pill");
    // Untouched fields keep the default rather than becoming undefined.
    expect(resolved.ink).toBe("ink");
    expect(resolved.opacity).toBe(1);
  });

  it("clamps opacity and text scale, so a document cannot go invisible", () => {
    const clamped = clampStyle({ opacity: 0.01, textScale: 9 });
    expect(clamped.opacity).toBe(OPACITY_FLOOR);
    expect(clamped.textScale).toBe(TEXT_SCALE_MAX);
  });

  it("refuses a style that names a value instead of a role", () => {
    expect(surfaceStyleSchema.safeParse({ surface: "#ff0000" }).success).toBe(false);
    expect(surfaceStyleSchema.safeParse({ surface: "accent" }).success).toBe(true);
    expect(surfaceStyleSchema.safeParse({ opacity: 0 }).success).toBe(false);
  });

  it("derives a dash direction from the geometry", () => {
    // A box runs clockwise from its top edge; a link runs source to target.
    expect(defaultEdgeFlow("top")).toBe("forward");
    expect(defaultEdgeFlow("right")).toBe("forward");
    expect(defaultEdgeFlow("bottom")).toBe("reverse");
    expect(defaultEdgeFlow("link")).toBe("forward");
  });

  it("knows when a record says nothing, so callers can drop it", () => {
    expect(isEmptyStyle(undefined)).toBe(true);
    expect(isEmptyStyle({})).toBe(true);
    expect(isEmptyStyle({ sides: {} })).toBe(true);
    expect(isEmptyStyle({ shape: "circle" })).toBe(false);
    expect(isEmptyStyle({ sides: { top: { paint: "dashed" } } })).toBe(false);
  });

  it("keeps only the sides a style names", () => {
    const resolved = resolveSurfaceStyle(
      { sides: { top: { paint: "dotted", flow: "reverse" } } },
      "section",
    );
    expect(resolved.sides.top?.paint).toBe("dotted");
    expect(resolved.sides.left).toBeUndefined();
  });
});

describe("the ink a colour can carry", () => {
  const LIGHT = {
    canvas: "#f5f5f7",
    surface: "#ffffff",
    "surface-strong": "#ffffff",
    ink: "#1d1d1f",
    "ink-muted": "#68686d",
    accent: "#0a84ff",
  };

  it("picks the first candidate that clears the floor", () => {
    // A saturated blue carries the theme's own ink comfortably.
    expect(pickInk("#3b82f6", LIGHT)).toEqual({ ink: "ink", ratio: expect.any(Number) });
    expect(pickInk("#3b82f6", LIGHT)?.ratio).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });

  it("reaches past the ink when the colour is too dark for it", () => {
    // Near-black on near-black: the first readable candidate is a light one.
    const picked = pickInk("#141414", LIGHT);
    expect(picked?.ratio).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    expect(picked?.ink).not.toBe("ink");
  });

  it("reports the best it can find when nothing clears the floor", () => {
    const grey = pickInk("#808080", { ink: "#7d7d7d", "ink-muted": "#828282" });
    expect(grey?.ratio).toBeLessThan(CONTRAST_FLOOR);
  });

  it("says nothing at all when there is no palette to measure", () => {
    expect(pickInk("#3b82f6", {})).toBeNull();
    expect(pickInk("rgba(0, 0, 0, 0.2)", LIGHT)).toBeNull();
  });
});
