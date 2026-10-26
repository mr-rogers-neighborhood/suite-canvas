import { describe, expect, it } from "vitest";
import { isNudgeKey, NUDGE_LARGE_STEP, NUDGE_STEP, nudgeDelta } from "./nudge";

describe("arrow-key nudge", () => {
  it("moves one step per arrow, in the direction pressed", () => {
    expect(nudgeDelta("ArrowRight", false)).toEqual({ dx: NUDGE_STEP, dy: 0 });
    expect(nudgeDelta("ArrowUp", false)).toEqual({ dx: 0, dy: -NUDGE_STEP });
  });

  it("moves further with the large step", () => {
    expect(nudgeDelta("ArrowLeft", true)).toEqual({ dx: -NUDGE_LARGE_STEP, dy: 0 });
    expect(NUDGE_LARGE_STEP).toBeGreaterThan(NUDGE_STEP);
  });

  it("claims only the four arrow keys", () => {
    expect(isNudgeKey("ArrowDown")).toBe(true);
    expect(isNudgeKey("Enter")).toBe(false);
    expect(nudgeDelta("Delete", false)).toBeNull();
  });
});
