import { describe, expect, it } from "vitest";

import { ICE_MAX_ZOOM, ICE_MIN_ZOOM, restorableCamera } from "./iceSurfaceCamera";

describe("restorable camera", () => {
  it("should restore a camera the desk can stand in", () => {
    expect(restorableCamera({ x: -240, y: 96, zoom: 1.5 })).toEqual({ x: -240, y: 96, zoom: 1.5 });
  });

  it("should keep the ends of ICE's zoom band", () => {
    expect(restorableCamera({ x: 0, y: 0, zoom: ICE_MIN_ZOOM })).not.toBeNull();
    expect(restorableCamera({ x: 0, y: 0, zoom: ICE_MAX_ZOOM })).not.toBeNull();
  });

  it("should refuse a camera that cannot be drawn", () => {
    expect(restorableCamera({ x: Number.NaN, y: 0, zoom: 1 })).toBeNull();
    expect(restorableCamera({ x: 0, y: Number.POSITIVE_INFINITY, zoom: 1 })).toBeNull();
    expect(restorableCamera({ x: 0, y: 0, zoom: 0 })).toBeNull();
    expect(restorableCamera({ x: 0, y: 0, zoom: -2 })).toBeNull();
    expect(restorableCamera({ x: 0, y: 0, zoom: ICE_MIN_ZOOM / 2 })).toBeNull();
    expect(restorableCamera({ x: 0, y: 0, zoom: ICE_MAX_ZOOM * 2 })).toBeNull();
  });
});
