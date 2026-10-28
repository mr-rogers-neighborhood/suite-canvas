import { describe, expect, it, vi } from "vitest";
import {
  createEstimateSampler,
  FILL_THRESHOLDS,
  fillPercent,
  fillRatio,
  fillStage,
} from "./estimateWatch";

describe("fillRatio", () => {
  it("should be the used share of the quota", () => {
    expect(fillRatio({ usage: 750, quota: 1000 })).toBeCloseTo(0.75);
  });

  it("should refuse to answer when the browser will not say", () => {
    expect(fillRatio({ usage: null, quota: 1000 })).toBeNull();
    expect(fillRatio({ usage: 750, quota: null })).toBeNull();
    expect(fillRatio({ usage: 750, quota: 0 })).toBeNull();
    expect(fillRatio({ usage: 750, quota: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("should stay inside the unit interval when the estimate disagrees with itself", () => {
    expect(fillRatio({ usage: 2000, quota: 1000 })).toBe(1);
    expect(fillRatio({ usage: -1, quota: 1000 })).toBe(0);
  });
});

describe("fillStage", () => {
  it("should cross at the same thresholds the copy prints", () => {
    expect(fillStage(null)).toBe("fine");
    expect(fillStage(FILL_THRESHOLDS.low - 0.01)).toBe("fine");
    expect(fillStage(FILL_THRESHOLDS.low)).toBe("low");
    expect(fillStage(FILL_THRESHOLDS.critical - 0.01)).toBe("low");
    expect(fillStage(FILL_THRESHOLDS.critical)).toBe("critical");
  });
});

describe("fillPercent", () => {
  it("should never round up into a whole disk", () => {
    expect(fillPercent(0.996)).toBe(99);
    expect(fillPercent(1)).toBe(99);
  });

  it("should never print zero for space that is genuinely used", () => {
    expect(fillPercent(0.0001)).toBe(1);
  });

  it("should round to the nearest percent in between", () => {
    expect(fillPercent(0.745)).toBe(75);
  });
});

describe("createEstimateSampler", () => {
  it("should measure the first note and then hold off for the interval", () => {
    const refresh = vi.fn(async () => undefined);
    let at = 0;
    const sampler = createEstimateSampler({ refresh, interval: 30_000, now: () => at });

    sampler.note();
    expect(refresh).toHaveBeenCalledTimes(1);

    at = 29_999;
    sampler.note();
    expect(refresh).toHaveBeenCalledTimes(1);

    at = 30_000;
    sampler.note();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("should not hold a timer between notes", () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn(async () => undefined);
      const sampler = createEstimateSampler({ refresh });
      sampler.note();
      vi.advanceTimersByTime(120_000);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
