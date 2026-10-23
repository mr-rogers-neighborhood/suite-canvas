import { describe, expect, it } from "vitest";
import {
  GRAPH_DEPTH_MAX,
  GRAPH_DEPTH_MIN_SCALE,
  GRAPH_DEPTH_SCALE_STEP,
  GRAPH_DEPTH_STEP_PX,
  graphDepthLevel,
  graphDepthOffset,
} from "./suiteGraphDepth";

describe("graphDepthOffset", () => {
  it("should be the identity at zero depth", () => {
    expect(graphDepthOffset(0)).toEqual({ level: 0, dx: 0, dy: 0, scale: 1, shadow: 0 });
    // Negative zero would fail an equality check and read as a real offset.
    expect(Object.is(graphDepthOffset(0).dx, 0)).toBe(true);
    expect(Object.is(graphDepthOffset(0).dy, 0)).toBe(true);
  });

  it("should step monotonically up-left, smaller and darker with every level", () => {
    let previous = graphDepthOffset(0);
    for (let depth = 1; depth <= GRAPH_DEPTH_MAX; depth += 1) {
      const current = graphDepthOffset(depth);
      expect(current.level).toBe(depth);
      // Up-left: both axes decrease (screen y grows down).
      expect(current.dx).toBeLessThan(previous.dx);
      expect(current.dy).toBeLessThan(previous.dy);
      expect(current.dx).toBe(current.dy);
      expect(current.dx).toBe(-GRAPH_DEPTH_STEP_PX * depth);
      // Never grows, never vanishes, and the shadow only deepens.
      expect(current.scale).toBeLessThanOrEqual(previous.scale);
      expect(current.scale).toBeGreaterThanOrEqual(GRAPH_DEPTH_MIN_SCALE);
      expect(current.shadow).toBeGreaterThan(previous.shadow);
      expect(current.shadow).toBeLessThanOrEqual(1);
      previous = current;
    }
  });

  it("should clamp past the deepest level this projection draws", () => {
    const deepest = graphDepthOffset(GRAPH_DEPTH_MAX);
    expect(graphDepthOffset(GRAPH_DEPTH_MAX + 1)).toEqual(deepest);
    expect(graphDepthOffset(1_000)).toEqual(deepest);
    expect(graphDepthOffset(Number.POSITIVE_INFINITY)).toEqual(graphDepthOffset(0));
  });

  it("should floor at the minimum scale however deep the stack goes", () => {
    const deepest = graphDepthOffset(GRAPH_DEPTH_MAX);
    expect(deepest.scale).toBeCloseTo(1 - GRAPH_DEPTH_SCALE_STEP * GRAPH_DEPTH_MAX, 10);
    expect(deepest.scale).toBeGreaterThanOrEqual(GRAPH_DEPTH_MIN_SCALE);
    expect(GRAPH_DEPTH_MIN_SCALE).toBeLessThanOrEqual(1);
  });

  it("should treat an unusable depth as the surface", () => {
    expect(graphDepthOffset(-3)).toEqual(graphDepthOffset(0));
    expect(graphDepthOffset(Number.NaN)).toEqual(graphDepthOffset(0));
    expect(graphDepthOffset(undefined)).toEqual(graphDepthOffset(0));
  });

  it("should be deterministic and round a fractional depth", () => {
    expect(graphDepthOffset(2.2)).toEqual(graphDepthOffset(2));
    expect(graphDepthOffset(2)).toEqual(graphDepthOffset(2));
    expect(graphDepthLevel(2.6)).toBe(3);
    expect(graphDepthLevel(2.4)).toBe(2);
  });
});
