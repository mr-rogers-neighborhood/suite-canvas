import { describe, expect, it } from "vitest";
import {
  clampStyle,
  defaultEdgeFlow,
  isEmptyStyle,
  OPACITY_FLOOR,
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
