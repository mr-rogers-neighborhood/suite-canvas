import { describe, expect, it } from "vitest";
import {
  canvasPurposes,
  initialGestureFor,
  nextPurpose,
  PURPOSE_NAMES,
  purposeClaimsClicks,
  purposeReadsGesture,
} from "./purpose";

/**
 * The purpose axis (ADR-0064). These tests pin the two properties that make two
 * axes safe: the cycle covers every value exactly once, and exactly the purposes
 * that consume clicks are named as such — which is what lets a component refuse
 * to arm a run while recording, instead of guessing.
 */

describe("the purpose cycle", () => {
  it("walks explore → run → record → present → explore", () => {
    const walked: string[] = [];
    let purpose = canvasPurposes[0];
    for (let index = 0; index < canvasPurposes.length; index += 1) {
      walked.push(purpose);
      purpose = nextPurpose(purpose);
    }

    expect(walked).toEqual(["explore", "run", "record", "present"]);
    // One full cycle returns to the start rather than to a fifth value.
    expect(purpose).toBe("explore");
  });

  it("names every purpose, so a label can never be missing", () => {
    for (const purpose of canvasPurposes) {
      expect(PURPOSE_NAMES[purpose]).toBe(purpose);
    }
  });
});

describe("what a purpose implies", () => {
  it("reads the gesture everywhere except while presenting", () => {
    expect(purposeReadsGesture("explore")).toBe(true);
    expect(purposeReadsGesture("run")).toBe(true);
    expect(purposeReadsGesture("record")).toBe(true);
    // A presentation ignores the tool rather than resetting it, so leaving it
    // returns the reader to what they had.
    expect(purposeReadsGesture("present")).toBe(false);
  });

  it("names run and record as the click-consuming purposes, and only those", () => {
    expect(purposeClaimsClicks("run")).toBe(true);
    expect(purposeClaimsClicks("record")).toBe(true);
    expect(purposeClaimsClicks("explore")).toBe(false);
    expect(purposeClaimsClicks("present")).toBe(false);
  });

  it("starts a run and a record in thread, because both are sequences by default", () => {
    expect(initialGestureFor("run")).toBe("thread");
    expect(initialGestureFor("record")).toBe("thread");
    // Exploring and presenting have no opinion, so the reader keeps their tool.
    expect(initialGestureFor("explore")).toBeNull();
    expect(initialGestureFor("present")).toBeNull();
  });
});
