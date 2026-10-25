import type { Section, SurfaceStyle } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { sectionPaint } from "./SectionLayer";
import { SECTION_FILL } from "./sectionPalette";

function section(style?: SurfaceStyle): Section {
  return {
    id: "s1",
    boardId: "b1",
    title: "Notes",
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    z: 0,
    color: "blue",
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...(style ? { style } : {}),
  };
}

describe("sectionPaint", () => {
  it("paints nothing at all for an unstyled section", () => {
    expect(sectionPaint(section())).toEqual({});
  });

  it("resolves a diamond silhouette and a dashed side into paint", () => {
    const paint = sectionPaint(section({ shape: "diamond", sides: { top: { paint: "dashed" } } }));

    expect(paint["--paint-clip"]).toBe("polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)");
    expect(paint["--paint-border-top"]).toBe("1px dashed var(--ink)");
    // A diamond names no radius, so the CSS keeps the section's own 12px.
    expect(paint["--paint-radius"]).toBeUndefined();
    expect(paint["--paint-surface"]).toBe(SECTION_FILL.blue);
    expect(paint["--paint-ink"]).toBe("var(--ink)");
    expect(paint["--paint-opacity"]).toBe("1");
    expect(paint["--paint-text-scale"]).toBe("1");
  });

  it("lets a named background replace the section's colour wash", () => {
    const paint = sectionPaint(
      section({ surface: "ink", ink: "surface", opacity: 0.5, radius: 24 }),
    );

    expect(paint["--paint-surface"]).toBe("var(--ink)");
    expect(paint["--paint-ink"]).toBe("var(--surface)");
    expect(paint["--paint-opacity"]).toBe("0.5");
    expect(paint["--paint-radius"]).toBe("24px");
  });

  it("carries the canvas role for a seamless surface", () => {
    expect(sectionPaint(section({ surface: "none" }))["--paint-surface"]).toBe("transparent");
  });

  it("drops a flowing side's border in favour of a marching strip", () => {
    const paint = sectionPaint(
      section({ sides: { top: { paint: "dashed", flow: "forward", speed: 2 } } }),
    );

    expect(paint["--paint-border-top"]).toBe("none");
    expect(paint["--paint-dash-top"]).toBe(
      "repeating-linear-gradient(90deg, var(--ink) 0 6px, transparent 6px 12px)",
    );
    expect(paint["--paint-dash-size-top"]).toBe("calc(100% + 12px) 1px");
    expect(paint["--paint-animation-top"]).toBe("top-dash 2s linear infinite");
  });

  it("marches a vertical side along its own axis", () => {
    const paint = sectionPaint(
      section({ sides: { left: { paint: "dotted", flow: "reverse", width: 3 } } }),
    );

    expect(paint["--paint-dash-left"]).toBe(
      "repeating-linear-gradient(180deg, var(--ink) 0 2px, transparent 2px 12px)",
    );
    expect(paint["--paint-dash-size-left"]).toBe("3px calc(100% + 12px)");
    expect(paint["--paint-animation-left"]).toBe("left-dash 4s linear infinite reverse");
  });

  it("keeps a still dash static", () => {
    const paint = sectionPaint(section({ sides: { bottom: { paint: "dashed" } } }));

    expect(paint["--paint-border-bottom"]).toBe("1px dashed var(--ink)");
    expect(paint["--paint-dash-bottom"]).toBeUndefined();
    expect(paint["--paint-animation-bottom"]).toBeUndefined();
  });
});
