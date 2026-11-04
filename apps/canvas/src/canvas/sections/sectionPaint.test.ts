import type { PaletteSwatch, Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { sectionPaint } from "./SectionLayer";
import { SECTION_FILL, SECTION_STROKE } from "./sectionPalette";

/**
 * A section's frame is its colour wash and nothing else.
 *
 * It used to carry a full `SurfaceStyle` on top of its colour, which meant three
 * ways to say "this box is blue" and a paint rule for each. The colour is the
 * whole choice; the frame's ink, radius and edges are the theme's.
 */

const section = (over: Partial<Section> = {}): Section =>
  ({
    id: "s1",
    boardId: "b1",
    title: "Act one",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    z: 0,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as Section;

const palette: readonly PaletteSwatch[] = [
  {
    id: "blue",
    name: "Blue",
    light: "#3b82f6",
    dark: "#60a5fa",
    inkLight: "ink",
    inkDark: "surface-strong",
  },
];

describe("sectionPaint", () => {
  it("paints the section's own colour", () => {
    expect(sectionPaint(section({ color: "blue" }), palette, "light")).toEqual({
      "--paint-surface": "color-mix(in srgb, #3b82f6 10%, transparent)",
    });
  });

  it("takes the mode's value of the swatch", () => {
    expect(sectionPaint(section({ color: "blue" }), palette, "dark")).toEqual({
      "--paint-surface": "color-mix(in srgb, #60a5fa 10%, transparent)",
    });
  });

  it("falls back to the shipped token when the palette no longer holds the id", () => {
    expect(sectionPaint(section({ color: "blue" }), [], "light")).toEqual({
      "--paint-surface": SECTION_FILL.blue,
    });
  });

  it("paints the theme's own section colour for an id no vocabulary knows", () => {
    // A swatch deleted after a frame wore it leaves the id behind. Painting slate beats
    // painting nothing — the frame keeps a colour and the next pick replaces it.
    expect(sectionPaint(section({ color: "gone" }), palette, "light")).toEqual({
      "--paint-surface": SECTION_FILL.slate,
    });
    expect(SECTION_STROKE.slate).toBe("var(--section-slate)");
  });

  it("writes nothing for a section that never picked a colour", () => {
    // The frame's own default is already the answer; marking it painted would
    // repaint a section nobody styled.
    expect(sectionPaint(section(), palette, "light")).toEqual({});
  });

  it("carries nothing else, because nothing else is a section's to decide", () => {
    const paint = sectionPaint(section({ color: "blue" }), palette, "light");

    expect(Object.keys(paint)).toEqual(["--paint-surface"]);
  });
});
