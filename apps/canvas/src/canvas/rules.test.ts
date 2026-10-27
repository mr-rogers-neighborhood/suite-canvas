import type { SurfaceStyle } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  CONTRAST_FLOOR,
  contrastRatio,
  mergeSurfaceStyle,
  resolveSurfaceStyleFor,
  type SurfacePalette,
  surfacePaintFor,
} from "./rules";

const card = { surface: "card" } as const;

const typeStyle: SurfaceStyle = { surface: "surface", shape: "pill", radius: 8 };
const ownStyle: SurfaceStyle = { shape: "diamond", ink: "accent" };

describe("two levels", () => {
  it("should paint a card from its type when the card names nothing", () => {
    const resolved = resolveSurfaceStyleFor(undefined, typeStyle, card);

    expect(resolved.applied).toBe(true);
    expect(resolved.style.shape).toBe("pill");
    expect(resolved.style.radius).toBe(8);
  });

  it("should let the card win over its type, field by field", () => {
    const resolved = resolveSurfaceStyleFor(ownStyle, typeStyle, card);

    // The card overrides the shape and adds an ink; the type's radius survives,
    // because a level only speaks for the fields it names.
    expect(resolved.style.shape).toBe("diamond");
    expect(resolved.style.ink).toBe("accent");
    expect(resolved.style.radius).toBe(8);
  });

  it("should keep per-side edges from the type when the card names a different side", () => {
    const merged = mergeSurfaceStyle(
      { sides: { top: { paint: "dashed" } } },
      { sides: { bottom: { paint: "dotted" } } },
    );

    expect(merged.sides?.top?.paint).toBe("dashed");
    expect(merged.sides?.bottom?.paint).toBe("dotted");
  });

  it("should report nothing for a surface neither level names", () => {
    const resolved = resolveSurfaceStyleFor(undefined, undefined, card);

    expect(resolved.applied).toBe(false);
    expect(resolved.corrections).toEqual([]);
  });

  it("should paint a styled card through the shared paint variables", () => {
    const painted = surfacePaintFor(undefined, typeStyle, card, {});

    expect(painted.paint["--paint-radius"]).toBeDefined();
    expect(painted.paint["--paint-surface"]).toBeDefined();
  });

  it("should paint a swatch with the colour the reader chose, not the role", () => {
    const painted = surfacePaintFor({ swatch: "blue" }, typeStyle, card, {}, "#3b82f6");

    expect(painted.paint["--paint-surface"]).toBe("#3b82f6");
  });
});

describe("the contrast floor", () => {
  const palette: SurfacePalette = {
    surface: "#ffffff",
    "surface-strong": "#ffffff",
    ink: "#1d1d1f",
    "ink-muted": "#68686d",
    accent: "#0a84ff",
    canvas: "#f5f5f7",
  };

  it("should read WCAG ratios from hex pairs", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("rgba(0, 0, 0, 0.08)", "#ffffff")).toBeNull();
  });

  it("should correct and report ink a level puts below the floor", () => {
    // A pale ink on a white surface: 1.14:1, far under the floor.
    const resolved = resolveSurfaceStyleFor(
      { surface: "surface", ink: "surface-strong" },
      undefined,
      card,
      palette,
    );

    expect(resolved.style.ink).not.toBe("surface-strong");
    expect(resolved.corrections).toHaveLength(1);
    const correction = resolved.corrections[0];
    expect(correction?.ink).toBe("surface-strong");
    expect(correction?.corrected).toBe(resolved.style.ink);
    expect(correction?.floor).toBe(CONTRAST_FLOOR);
    expect(correction?.ratio).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });

  it("should leave a legible pair exactly as it was written", () => {
    const resolved = resolveSurfaceStyleFor(
      { surface: "surface", ink: "ink" },
      undefined,
      card,
      palette,
    );

    expect(resolved.style.ink).toBe("ink");
    expect(resolved.corrections).toEqual([]);
  });

  it("should measure a swatch the reader chose, not the role underneath it", () => {
    // #ffffff is unreadable against a white ink; the role would have been dark.
    const resolved = resolveSurfaceStyleFor(
      { swatch: "paper", ink: "surface-strong" },
      undefined,
      card,
      palette,
      "#fefefe",
    );

    expect(resolved.corrections).toHaveLength(1);
  });

  it("should stay out of the way when there is nothing to measure", () => {
    expect(
      resolveSurfaceStyleFor({ surface: "surface", ink: "surface-strong" }, undefined, card)
        .corrections,
    ).toEqual([]);
    // A seamless surface has no background to measure against.
    expect(
      resolveSurfaceStyleFor({ surface: "none", ink: "warning" }, undefined, card, palette)
        .corrections,
    ).toEqual([]);
  });
});
