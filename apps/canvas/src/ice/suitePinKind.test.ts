import { describe, expect, it } from "vitest";
import {
  SUITE_PIN_KIND,
  SUITE_PIN_LABEL_MIN_ZOOM,
  SUITE_PIN_MARKER_PX,
  SUITE_PIN_TYPE,
  SuitePin,
  type SuitePinFace,
  suitePinMarker,
} from "./suitePinKind";

const face: SuitePinFace = {
  pinId: "pin-1",
  boardId: "board-1",
  label: "Reading room",
  color: "rose",
};

/** A pin at world (100, 50), as the reused paper kind's geometry reports it. */
const geometry = { centre: [100, 50] as const, alpha: 1 };
const camera = { x: 0, y: 0, zoom: 1 };

describe("suitePinMarker", () => {
  it("should size the marker in screen pixels, never in world units", () => {
    const sizes = [0.25, 0.5, 1, 2, 8].map(
      (zoom) => suitePinMarker(geometry, { ...camera, zoom }, face)?.size,
    );
    expect(sizes).toEqual([
      SUITE_PIN_MARKER_PX,
      SUITE_PIN_MARKER_PX,
      SUITE_PIN_MARKER_PX,
      SUITE_PIN_MARKER_PX,
      SUITE_PIN_MARKER_PX,
    ]);
  });

  it("should move the marker with the camera but keep it centred on the pin", () => {
    const atRest = suitePinMarker(geometry, camera, face);
    expect(atRest).toMatchObject({
      left: 100 - SUITE_PIN_MARKER_PX / 2,
      top: 50 - SUITE_PIN_MARKER_PX / 2,
    });

    const zoomed = suitePinMarker(geometry, { x: 20, y: 10, zoom: 2 }, face);
    expect(zoomed).toMatchObject({
      left: (100 - 20) * 2 - SUITE_PIN_MARKER_PX / 2,
      top: (50 - 10) * 2 - SUITE_PIN_MARKER_PX / 2,
      size: SUITE_PIN_MARKER_PX,
    });
  });

  it("should hide the label below the readable zoom and keep the marker", () => {
    const far = suitePinMarker(geometry, { ...camera, zoom: SUITE_PIN_LABEL_MIN_ZOOM / 2 }, face);
    expect(far).not.toBeNull();
    expect(far?.showLabel).toBe(false);

    const near = suitePinMarker(geometry, { ...camera, zoom: SUITE_PIN_LABEL_MIN_ZOOM }, face);
    expect(near?.showLabel).toBe(true);
  });

  it("should draw nothing when the geometry or camera is missing", () => {
    expect(suitePinMarker(null, camera, face)).toBeNull();
    expect(suitePinMarker(undefined, camera, face)).toBeNull();
    expect(suitePinMarker(geometry, null, face)).toBeNull();
    expect(suitePinMarker(geometry, undefined, face)).toBeNull();
  });

  it("should draw nothing for unusable geometry or a dead camera", () => {
    expect(suitePinMarker({ centre: [Number.NaN, 0] }, camera, face)).toBeNull();
    expect(suitePinMarker({ centre: [0, Number.POSITIVE_INFINITY] }, camera, face)).toBeNull();
    expect(suitePinMarker(geometry, { ...camera, zoom: 0 }, face)).toBeNull();
    expect(suitePinMarker(geometry, { ...camera, zoom: Number.NaN }, face)).toBeNull();
    // A faded-out pin is gone, as the paper kind's own presence says.
    expect(suitePinMarker({ ...geometry, alpha: 0 }, camera, face)).toBeNull();
  });

  it("should pass the label and colour through, and swatch an unknown colour slate", () => {
    expect(suitePinMarker(geometry, camera, face)).toMatchObject({
      label: "Reading room",
      color: "rose",
    });
    expect(suitePinMarker(geometry, camera, { ...face, color: "chartreuse" })?.color).toBe("slate");
    // No face means no label bubble, but the dot still marks the place.
    const bare = suitePinMarker(geometry, camera);
    expect(bare?.label).toBe("");
    expect(bare?.showLabel).toBe(false);
    expect(bare?.size).toBe(SUITE_PIN_MARKER_PX);
  });
});

describe("suite.pin kind", () => {
  it("should expose the same type and kind name", () => {
    expect(SuitePin.type).toBe(SUITE_PIN_TYPE);
    // The ground registers the paper program under this name, so they agree.
    expect(SUITE_PIN_KIND).toBe(SUITE_PIN_TYPE);
  });

  it("should carry the pin's coordinates and face on the pin group", () => {
    expect(SuitePin.propToGroup).toMatchObject({
      pinId: "pin",
      boardId: "pin",
      label: "pin",
      color: "pin",
    });
    const group = SuitePin.groups.find((candidate) => candidate.name === "pin");
    expect(group).toBeDefined();
  });
});
