import { DEFAULT_PALETTE, type PaletteSwatch } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  SECTION_DEFAULT,
  SECTION_FILL,
  SECTION_STROKE,
  sectionSwatch,
  sectionWash,
} from "./sectionPalette";

/**
 * One resolver for a frame's colour.
 *
 * The palette wins, then the shipped token whose id this is, then the theme's own section
 * colour. Every reader goes through it, so editing the palette repaints frames and cards
 * together instead of leaving the frames behind.
 */

const palette: readonly PaletteSwatch[] = [
  ...DEFAULT_PALETTE,
  {
    id: "ink-rinse",
    name: "Ink rinse",
    light: "#123456",
    dark: "#abcdef",
    inkLight: "ink",
    inkDark: "surface-strong",
  },
];

describe("sectionSwatch", () => {
  it("resolves a workspace swatch for the mode on screen", () => {
    expect(sectionSwatch("ink-rinse", palette, "light")).toEqual({
      stroke: "#123456",
      fill: "color-mix(in srgb, #123456 10%, transparent)",
    });
    expect(sectionSwatch("ink-rinse", palette, "dark")).toEqual({
      stroke: "#abcdef",
      fill: "color-mix(in srgb, #abcdef 10%, transparent)",
    });
  });

  it("keeps the shipped six on their own tokens when the palette is empty", () => {
    expect(sectionSwatch("rose", [], "light")).toEqual({
      stroke: SECTION_STROKE.rose,
      fill: SECTION_FILL.rose,
    });
  });

  it("gives a frame with no colour the theme's section colour", () => {
    expect(sectionSwatch(undefined, palette, "light")).toEqual(SECTION_DEFAULT);
  });

  it("gives an id no vocabulary knows the theme's section colour", () => {
    expect(sectionSwatch("gone", palette, "dark")).toEqual(SECTION_DEFAULT);
  });
});

describe("sectionWash", () => {
  it("mixes the colour at the weight asked for", () => {
    expect(sectionWash("#123456")).toBe("color-mix(in srgb, #123456 10%, transparent)");
    expect(sectionWash("#123456", 18)).toBe("color-mix(in srgb, #123456 18%, transparent)");
  });
});
