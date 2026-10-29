import { describe, expect, it } from "vitest";
import { sectionPressUnder } from "./useBoardSections";

/**
 * A section is selected by pressing its frame, and selecting one opens its panel — the same
 * gesture that opens a card's panel. So the menu bar's mode has to reach it, and the whole of
 * that rule is this table: what a press means in each mode.
 */
describe("a press on a section", () => {
  it("clears on an empty target whatever the mode says", () => {
    for (const mode of ["inspect", "quiet", "locked"] as const) {
      expect(sectionPressUnder(mode, null)).toBe("clear");
    }
  });

  it("does nothing while the canvas is locked", () => {
    expect(sectionPressUnder("locked", "section-1")).toBe("ignore");
  });

  it("selects and opens the panel in the reading mode", () => {
    expect(sectionPressUnder("inspect", "section-1")).toBe("select");
  });

  it("selects without the panel in quiet mode", () => {
    expect(sectionPressUnder("quiet", "section-1")).toBe("select-quietly");
  });
});
