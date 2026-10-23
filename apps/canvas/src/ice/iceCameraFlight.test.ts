import { describe, expect, it } from "vitest";
import {
  easeInOut,
  type FlightCamera,
  flightDone,
  planFlight,
  sampleFlight,
} from "./iceCameraFlight";

const VIEWPORT = { width: 1440, height: 900 };
const at = (x: number, y: number, zoom: number): FlightCamera => ({ x, y, zoom });
/** `x`/`y` are screen-space offsets of the world top-left, the way the surface passes them. */
const home = at(0, 0, 1);

describe("planFlight", () => {
  it("resolves a still plan for a missing or unusable camera instead of throwing", () => {
    expect(planFlight(null, home, VIEWPORT)).toMatchObject({ moving: false, durationMs: 0 });
    expect(planFlight(home, undefined, VIEWPORT)).toMatchObject({ moving: false });
    expect(planFlight(home, at(0, 0, 0), VIEWPORT)).toMatchObject({ moving: false });
    expect(planFlight(home, at(Number.NaN, 0, 1), VIEWPORT)).toMatchObject({ moving: false });
  });

  it("treats a sub-1% nudge with no zoom change as no movement", () => {
    const plan = planFlight(home, at(3, 2, 1), VIEWPORT);
    expect(plan.moving).toBe(false);
    expect(plan.durationMs).toBe(0);
  });

  it("scales duration with distance, monotonically", () => {
    const near = planFlight(home, at(0, 0, 1) && at(200, 0, 1), VIEWPORT);
    const mid = planFlight(home, at(1200, 0, 1), VIEWPORT);
    const far = planFlight(home, at(9000, 0, 1), VIEWPORT);
    expect(near.moving).toBe(true);
    expect(near.durationMs).toBeLessThan(mid.durationMs);
    expect(mid.durationMs).toBeLessThan(far.durationMs);
    // …and it never runs away.
    expect(planFlight(home, at(1_000_000, 0, 1), VIEWPORT).durationMs).toBeLessThanOrEqual(2400);
  });

  it("charges a doubling of zoom the same as halving it", () => {
    const inPlan = planFlight(home, at(0, 0, 2), VIEWPORT);
    const outPlan = planFlight(home, at(0, 0, 0.5), VIEWPORT);
    expect(inPlan.zoomSteps).toBeCloseTo(1);
    expect(outPlan.zoomSteps).toBeCloseTo(1);
    expect(inPlan.durationMs).toBe(outPlan.durationMs);
  });

  it("measures the pan at the destination zoom, not the origin", () => {
    // Both flights move the view's top-left by 1000 world units; landing at 2x
    // makes that twice as far on screen, so it is a longer flight.
    const slow = planFlight(home, at(1000, 0, 1), VIEWPORT);
    const fast = planFlight(home, at(2000, 0, 2), VIEWPORT);
    expect(slow.panPx).toBeCloseTo(1000);
    expect(fast.panPx).toBeCloseTo(2000);
    expect(fast.durationMs).toBeGreaterThan(slow.durationMs);
  });

  it("never animates shorter than the floor", () => {
    const plan = planFlight(home, at(0, 0, 1.02), VIEWPORT, { minMs: 220 });
    expect(plan.durationMs).toBeGreaterThanOrEqual(220);
  });
});

describe("sampleFlight", () => {
  it("interpolates zoom geometrically, so half way through 1x→4x is 2x", () => {
    const plan = planFlight(home, at(0, 0, 4), VIEWPORT);
    const middle = sampleFlight(plan, plan.durationMs / 2);
    expect(middle.zoom).toBeCloseTo(2, 5);
  });

  it("starts at the origin, ends at the destination, and clamps outside the window", () => {
    const from = at(120, 80, 1);
    const to = at(-900, 400, 0.25);
    const plan = planFlight(from, to, VIEWPORT);
    expect(sampleFlight(plan, -50)).toEqual(from);
    expect(sampleFlight(plan, plan.durationMs + 50)).toEqual(to);
    expect(sampleFlight(plan, 0)).toEqual(from);
    expect(sampleFlight(plan, plan.durationMs)).toEqual(to);
  });

  it("keeps the world point under the viewport centre on a straight line", () => {
    const plan = planFlight(home, at(600, 300, 2), VIEWPORT);
    const half = sampleFlight(plan, plan.durationMs / 2);
    // The world top-left travels 0 → (300, 150); half way is (150, 75), and the
    // camera value is that world point times the interpolated zoom.
    expect(half.x / half.zoom).toBeCloseTo(150, 5);
    expect(half.y / half.zoom).toBeCloseTo(75, 5);
    expect(half.zoom).toBeCloseTo(Math.SQRT2, 5);
  });

  it("is still at rest", () => {
    const plan = planFlight(home, home, VIEWPORT);
    expect(sampleFlight(plan, 0)).toEqual(home);
    expect(flightDone(plan, 0)).toBe(true);
  });
});

describe("easeInOut", () => {
  it("is clamped, symmetric and monotonic", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1);
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const value = easeInOut(t);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });
});
