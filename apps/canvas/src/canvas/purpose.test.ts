import { describe, expect, it } from "vitest";
import {
  type CanvasPurpose,
  canvasPurposes,
  choosablePurposes,
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
  it("walks explore → run → explain → explore", () => {
    const walked: string[] = [];
    let purpose: CanvasPurpose = choosablePurposes[0];
    for (let index = 0; index < choosablePurposes.length; index += 1) {
      walked.push(purpose);
      purpose = nextPurpose(purpose);
    }

    expect(walked).toEqual(["explore", "run", "explain"]);
    // One full cycle returns to the start.
    expect(purpose).toBe("explore");
  });

  it("cannot be walked into present, because a presentation belongs to a tour", () => {
    // Every value a reader can reach by clicking, reached by clicking.
    const reachable = new Set<string>();
    let purpose: CanvasPurpose = "explore";
    for (let step = 0; step < 9; step += 1) {
      purpose = nextPurpose(purpose);
      reachable.add(purpose);
    }

    // `record` and `present` are tour states, not modes a reader picks.
    expect(reachable.has("present")).toBe(false);
    expect(reachable.has("record")).toBe(false);
    expect([...reachable].sort()).toEqual(["explain", "explore", "run"]);
  });

  it("leaves present for the resting state, the one move a tour allows", () => {
    // Not a continuation of a cycle the tour never started: the tour put the
    // reader here, and the widget is only the exit (§11).
    expect(nextPurpose("present")).toBe("explore");
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
