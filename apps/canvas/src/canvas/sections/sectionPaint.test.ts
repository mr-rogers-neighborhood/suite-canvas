import type { Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { sectionPaint } from "./SectionLayer";
import { SECTION_FILL } from "./sectionPalette";

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

describe("sectionPaint", () => {
  it("paints the section's own colour", () => {
    expect(sectionPaint(section({ color: "blue" }))).toEqual({
      "--paint-surface": SECTION_FILL.blue,
    });
  });

  it("falls back to slate for a section that never picked one", () => {
    expect(sectionPaint(section())).toEqual({ "--paint-surface": SECTION_FILL.slate });
  });

  it("carries nothing else, because nothing else is a section's to decide", () => {
    const paint = sectionPaint(section({ color: "rose" }));

    expect(Object.keys(paint)).toEqual(["--paint-surface"]);
  });
});
