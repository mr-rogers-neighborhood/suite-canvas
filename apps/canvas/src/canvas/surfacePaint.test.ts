import {
  type ResolvedSurfaceStyle,
  resolveSurfaceStyle,
  type SurfaceStyle,
  styleShapes,
} from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  colourRoleVar,
  isShapedSurface,
  shapeClipPath,
  shapeInset,
  shapeOutline,
  shapeRadius,
  sideAnimation,
  sideBorder,
  sideStrip,
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
    // A patterned side draws no border: the strip is the edge, and it carries its own
    // thickness, because the browser's own `dashed` is a hairline at the thickness a card
    // edge has and a transparent border could be zeroed under it.
    expect(paint["--paint-border-top"]).toBe("0");
    expect(paint["--paint-dash-top"]).toContain("var(--accent)");
    expect(paint["--paint-dash-size-top"]).toBe("100% 2px");
    expect(paint["--paint-border-left"]).toBeUndefined();

    const removed = resolveSurfaceStyle({ sides: { bottom: { paint: "none" } } }, "card");
    expect(surfacePaintVars(removed)["--paint-border-bottom"]).toBe("none");
    expect(surfacePaintVars(removed)["--paint-dash-bottom"]).toBeUndefined();
  });

  it("draws dots and dashes apart, so one is never mistaken for the other", () => {
    const dashed = surfacePaintVars(
      resolveSurfaceStyle({ sides: { left: { paint: "dashed" } } }, "card"),
    );
    const dotted = surfacePaintVars(
      resolveSurfaceStyle({ sides: { left: { paint: "dotted" } } }, "card"),
    );

    // A vertical side runs its pattern downward, and a dot is thicker than a dash.
    expect(dashed["--paint-dash-left"]).toContain("to bottom");
    expect(dashed["--paint-dash-size-left"]).toBe("1.5px 100%");
    expect(dotted["--paint-dash-size-left"]).toBe("2px 100%");
    expect(dashed["--paint-dash-left"]).not.toBe(dotted["--paint-dash-left"]);
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

describe("a silhouette that is not the box", () => {
  it("publishes the shape as well as painting it", () => {
    const paint = surfacePaintVars(resolveSurfaceStyle({ shape: "diamond" }, "card"));
    // The clip path is for the browser; the variable is for everything that has to
    // agree with it — the chrome, the connector dots, the rectangle that must not paint.
    expect(paint["--paint-shape"]).toBe("diamond");
    expect(surfacePaintVars(resolveSurfaceStyle({ shape: "rect" }, "card"))["--paint-shape"]).toBe(
      undefined,
    );
  });

  it("counts every shape but a rectangle as shaped", () => {
    expect(isShapedSurface(undefined)).toBe(false);
    expect(isShapedSurface(null)).toBe(false);
    expect(isShapedSurface("rect")).toBe(false);
    for (const shape of styleShapes.filter((candidate) => candidate !== "rect")) {
      expect(isShapedSurface(shape)).toBe(true);
    }
  });

  /**
   * The geometry is a table and the paint is a string, so they are two statements of one
   * silhouette. This is what keeps them one: every polygon the clip path draws must have
   * a matching outline, with the same vertices in the same order.
   */
  it("draws the outline the clip path draws", () => {
    for (const shape of styleShapes) {
      const clip = shapeClipPath(shape);
      const outline = shapeOutline(shape);
      if (!clip) {
        expect(outline, `${shape} paints no polygon`).toBe(null);
        continue;
      }
      expect(outline, `${shape} paints a polygon`).not.toBe(null);
      const painted = clip
        .replace(/^polygon\(|\)$/g, "")
        .split(",")
        .map((pair) =>
          pair
            .trim()
            .split(/\s+/)
            .map((value) => Number.parseFloat(value) / 100),
        );
      expect(painted).toHaveLength(outline?.length ?? 0);
      painted.forEach(([x, y], index) => {
        expect(x).toBeCloseTo(outline?.[index]?.[0] ?? -1, 6);
        expect(y).toBeCloseTo(outline?.[index]?.[1] ?? -1, 6);
      });
    }
  });

  it("keeps the chrome inside the silhouette, and the title bar inside that", () => {
    const size = { width: 320, height: 200 };
    // A rectangle pays nothing.
    expect(shapeInset(undefined, size)).toEqual({ x: 0, y: 0, titleX: 0 });
    expect(shapeInset("rect", size)).toEqual({ x: 0, y: 0, titleX: 0 });

    // A circle inscribes a square of 70.7%, so its inset is 14.6% of each side.
    const circle = shapeInset("circle", size);
    expect(circle.x).toBeCloseTo(48, 0);
    expect(circle.y).toBeCloseTo(30, 0);

    // A diamond narrows toward its apex, so the title bar comes in further than the body:
    // a bar as wide as the text block would hang outside the paint.
    const diamond = shapeInset("diamond", size);
    expect(diamond.titleX).toBeGreaterThan(diamond.x);

    // A document is a rectangle with a turned corner: its bar is as wide as its body.
    const document = shapeInset("document", size);
    expect(document.titleX).toBe(document.x);
  });
});

/**
 * A patterned edge is one number drawn twice: a strip of a thickness, and the band it
 * occupies. They used to be two numbers a rule apart (a 1px fallback border under a 1.5px
 * strip), and the strip then painted partly outside the edge it stood for.
 */
describe("a patterned side reports the edge it draws", () => {
  const style = (paint: "dashed" | "dotted"): ResolvedSurfaceStyle =>
    resolveSurfaceStyle({ sides: { top: { paint } } } as SurfaceStyle, "card");

  for (const paint of ["dashed", "dotted"] as const) {
    it(`draws ${paint} at the thickness its strip claims`, () => {
      const resolved = style(paint);
      const strip = sideStrip(resolved, "top");
      const border = sideBorder(resolved, "top");
      if (!strip) throw new Error("expected a strip");
      // The band is exactly as thick as the edge, and one period long.
      expect(strip.size).toBe(`100% ${strip.thickness}px`);
      // No border holds its place: the strip is the edge, so nothing can zero the band.
      expect(border).toBe("0");
      expect(strip.period).toBeGreaterThan(0);
    });
  }

  it("lets a reader's own width win over the pattern's default", () => {
    const resolved = resolveSurfaceStyle(
      { sides: { top: { paint: "dashed", width: 4 } } } as SurfaceStyle,
      "card",
    );
    expect(sideStrip(resolved, "top")?.thickness).toBe(4);
    expect(sideStrip(resolved, "top")?.size).toBe("100% 4px");
    expect(sideBorder(resolved, "top")).toBe("0");
  });
});
