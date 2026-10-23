import { afterEach, describe, expect, it, vi } from "vitest";
import { markBoot, measureBoot, readBootTimings, resetBootTimings } from "./bootTiming";

afterEach(() => {
  vi.restoreAllMocks();
  resetBootTimings();
});

describe("boot timing", () => {
  it("should measure between two marks and expose the duration", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValueOnce(10);
    now.mockReturnValueOnce(34);

    markBoot("hydrate:start");
    markBoot("hydrate:end");
    expect(measureBoot("hydrate", "hydrate:start", "hydrate:end")).toBe(24);
    expect(readBootTimings()).toEqual([{ name: "hydrate", durationMs: 24 }]);
  });

  it("should not invent a duration from a missing mark", () => {
    markBoot("hydrate:end");
    expect(measureBoot("hydrate", "hydrate:start", "hydrate:end")).toBeNull();
    expect(readBootTimings()).toEqual([]);
  });
});
