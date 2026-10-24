import { describe, expect, it } from "vitest";
import {
  currentScreenCamera,
  IDENTITY_CAMERA,
  publishScreenCamera,
  screenToWorld,
} from "./iceScreenToWorld";

describe("iceScreenToWorld", () => {
  it("should invert ICE's screen mapping at the published camera", () => {
    // ICE: screen = (world - camera) * zoom. A world point of (300, 200) seen
    // through a camera at (100, 50) and 2× lands at screen (400, 300).
    const camera = { x: 100, y: 50, zoom: 2 };

    expect(screenToWorld({ x: 400, y: 300 }, camera)).toEqual({ x: 300, y: 200 });
  });

  it("should be the identity at a fresh camera", () => {
    expect(screenToWorld({ x: 45, y: -12 }, IDENTITY_CAMERA)).toEqual({ x: 45, y: -12 });
  });

  it("should hand the last published camera to the next gesture", () => {
    publishScreenCamera({ x: -800, y: 40, zoom: 0.5 });

    expect(currentScreenCamera()).toEqual({ x: -800, y: 40, zoom: 0.5 });
    // 100 CSS px is 200 world units at 0.5×, offset by the camera's -800.
    expect(screenToWorld({ x: 100, y: 100 })).toEqual({ x: -600, y: 240 });
  });

  it("should ignore a camera it cannot invert", () => {
    publishScreenCamera({ x: Number.NaN, y: 0, zoom: 1 });
    expect(currentScreenCamera()).toEqual(IDENTITY_CAMERA);

    publishScreenCamera({ x: 0, y: 0, zoom: 0 });
    expect(currentScreenCamera()).toEqual(IDENTITY_CAMERA);
  });
});
