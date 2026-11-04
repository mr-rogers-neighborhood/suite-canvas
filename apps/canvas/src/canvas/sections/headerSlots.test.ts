import { describe, expect, it } from "vitest";
import { HEADER_GAP, HEADER_HEIGHT, type HeaderFrame, headerSlots } from "./headerSlots";

function frame(overrides: Partial<HeaderFrame> & Pick<HeaderFrame, "id" | "x" | "y">): HeaderFrame {
  return { width: 400, height: 300, ...overrides };
}

const slotOf = (slots: Map<string, { x: number; y: number }>, id: string) => slots.get(id);

describe("section header slots", () => {
  it("puts a lone section's pill inside its own corner", () => {
    const slots = headerSlots([frame({ id: "a", x: 100, y: 200 })], 1);
    expect(slotOf(slots, "a")).toEqual({ x: 108, y: 206 });
  });

  it("leaves frames that share no corner alone", () => {
    const slots = headerSlots(
      [
        frame({ id: "a", x: 0, y: 0 }),
        frame({ id: "b", x: 900, y: 0 }),
        frame({ id: "c", x: 0, y: 800 }),
      ],
      1,
    );
    expect(slotOf(slots, "a")).toEqual({ x: 8, y: 6 });
    expect(slotOf(slots, "b")).toEqual({ x: 908, y: 6 });
    expect(slotOf(slots, "c")).toEqual({ x: 8, y: 806 });
  });

  /** The report this exists for: the child's pill sat exactly on the parent's. */
  it("drops a nested section's pill below the frame that holds it", () => {
    const slots = headerSlots(
      [
        frame({ id: "outer", x: 0, y: 0, width: 800, height: 600 }),
        frame({ id: "inner", x: 0, y: 0, width: 300, height: 200 }),
      ],
      1,
    );

    // The outer frame is the larger one, so it keeps the corner.
    expect(slotOf(slots, "outer")).toEqual({ x: 8, y: 6 });
    expect(slotOf(slots, "inner")).toEqual({ x: 8, y: 6 + HEADER_HEIGHT + HEADER_GAP });
  });

  it("stacks three levels of nesting one pill at a time", () => {
    const slots = headerSlots(
      [
        frame({ id: "outer", x: 0, y: 0, width: 900, height: 900 }),
        frame({ id: "middle", x: 0, y: 0, width: 500, height: 500 }),
        frame({ id: "inner", x: 0, y: 0, width: 200, height: 200 }),
      ],
      1,
    );
    const step = HEADER_HEIGHT + HEADER_GAP;
    expect(slotOf(slots, "outer")?.y).toBe(6);
    expect(slotOf(slots, "middle")?.y).toBe(6 + step);
    expect(slotOf(slots, "inner")?.y).toBe(6 + step * 2);
  });

  /**
   * The pill is counter-scaled, so at quarter zoom it covers four times as much flow space; a dodge
   * measured in flow units would put it back on its neighbour.
   */
  it("steps in flow units that match the scale the pill is painted at", () => {
    const sections = [
      frame({ id: "outer", x: 0, y: 0, width: 800, height: 600 }),
      frame({ id: "inner", x: 0, y: 0, width: 300, height: 200 }),
    ];
    const near = headerSlots(sections, 1);
    const far = headerSlots(sections, 0.25);
    const stepNear = (slotOf(near, "inner")?.y ?? 0) - (slotOf(near, "outer")?.y ?? 0);
    const stepFar = (slotOf(far, "inner")?.y ?? 0) - (slotOf(far, "outer")?.y ?? 0);

    expect(stepNear).toBe(HEADER_HEIGHT + HEADER_GAP);
    expect(stepFar).toBe((HEADER_HEIGHT + HEADER_GAP) / 0.25);
  });

  it("reads a missing scale as 1 rather than leaving pills unplaced", () => {
    const slots = headerSlots([frame({ id: "a", x: 10, y: 10 })], Number.NaN);
    expect(slotOf(slots, "a")).toEqual({ x: 18, y: 16 });
  });

  it("gives every section a slot, however many pile up", () => {
    const nested = Array.from({ length: 8 }, (_, index) =>
      frame({
        id: `s${index}`,
        x: 0,
        y: 0,
        width: 900 - index * 100,
        height: 900 - index * 100,
      }),
    );
    const slots = headerSlots(nested, 1);
    expect(slots.size).toBe(nested.length);
  });
});
