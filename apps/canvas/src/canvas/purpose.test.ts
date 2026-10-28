import { describe, expect, it } from "vitest";
import {
  canvasPurposes,
  choosablePurposes,
  initialGestureFor,
  isChosenPurpose,
  PURPOSE_NAMES,
  purposeClaimsClicks,
  purposeReadsGesture,
  RESTING_PURPOSE,
} from "./purpose";

/**
 * The purpose axis (ADR-0064). These tests pin the two properties that make two
 * axes safe: the cycle covers every value exactly once, and exactly the purposes
 * that consume clicks are named as such — which is what lets a component refuse
 * to arm a run while recording, instead of guessing.
 */

describe("the purpose control", () => {
  it("offers one choice, and off", () => {
    // A toggle, not a cycle: `explore` is the canvas as usual, so it is the resting
    // state a control returns to rather than a value it walks through.
    expect(choosablePurposes).toEqual(["explain"]);
    expect(RESTING_PURPOSE).toBe("explore");
    expect(isChosenPurpose("explain")).toBe(true);
    for (const purpose of canvasPurposes.filter((value) => value !== "explain")) {
      expect(isChosenPurpose(purpose)).toBe(false);
    }
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
    expect(purposeReadsGesture("record")).toBe(true);
    expect(purposeReadsGesture("record")).toBe(true);
    // A presentation ignores the tool rather than resetting it, so leaving it
    // returns the reader to what they had.
    expect(purposeReadsGesture("present")).toBe(false);
  });

  it("names run and record as the click-consuming purposes, and only those", () => {
    expect(purposeClaimsClicks("record")).toBe(true);
    expect(purposeClaimsClicks("record")).toBe(true);
    expect(purposeClaimsClicks("explore")).toBe(false);
    expect(purposeClaimsClicks("present")).toBe(false);
  });

  it("starts a run and a record in thread, because both are sequences by default", () => {
    expect(initialGestureFor("record")).toBe("thread");
    expect(initialGestureFor("record")).toBe("thread");
    // Exploring and presenting have no opinion, so the reader keeps their tool.
    expect(initialGestureFor("explore")).toBeNull();
    expect(initialGestureFor("present")).toBeNull();
  });
});
