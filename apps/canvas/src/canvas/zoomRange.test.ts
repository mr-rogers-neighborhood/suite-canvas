import { describe, expect, it } from "vitest";
import { clampZoom, ZOOM_MAX, ZOOM_MIN, zoomBand } from "./zoomRange";

describe("the camera range", () => {
  it("should reach from a map view to a close read", () => {
    expect(ZOOM_MIN).toBeLessThan(0.5);
    expect(ZOOM_MAX).toBeGreaterThan(2);
  });

  it("should clamp to the range, except while presenting", () => {
    expect(clampZoom(0.001)).toBe(ZOOM_MIN);
    expect(clampZoom(12)).toBe(ZOOM_MAX);
    expect(clampZoom(1.5)).toBe(1.5);
    // A presentation frames what the author framed, whatever the scale.
    expect(clampZoom(12, true)).toBe(12);
    expect(clampZoom(0.001, true)).toBe(0.001);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("content breakpoints", () => {
  it("should drop detail as the camera pulls back", () => {
    expect(zoomBand(0.1)).toBe("far");
    expect(zoomBand(0.5)).toBe("mid");
    expect(zoomBand(1)).toBe("near");
    expect(zoomBand(ZOOM_MAX)).toBe("near");
  });

  it("should read an unmeasurable scale as the full band", () => {
    expect(zoomBand(Number.NaN)).toBe("near");
    expect(zoomBand(Number.POSITIVE_INFINITY)).toBe("near");
  });
});
