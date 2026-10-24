import { describe, expect, it } from "vitest";
import {
  beginMiddlePan,
  endMiddlePan,
  MIDDLE_PAN_THRESHOLD,
  type MiddlePanPointer,
  type MiddlePanState,
  updateMiddlePan,
} from "./iceMiddlePan";

/** ICE's camera: the world point at the viewport's top-left, at `zoom`. */
const at = (x: number, y: number, zoom: number) => ({ x, y, zoom });

/** A press that the module accepted; a refusal is a test failure, not a null. */
function begin(pointer: MiddlePanPointer, camera = at(0, 0, 1)): MiddlePanState {
  const state = beginMiddlePan(pointer, camera);
  if (state === null) throw new Error("expected the press to begin a pan");
  return state;
}

/** The world point under a screen x, in ICE's convention. */
function worldAt(camera: { x: number; y: number; zoom: number }, screenX: number): number {
  return screenX / camera.zoom + camera.x;
}

describe("beginMiddlePan", () => {
  it("records the pointer, the camera and the same zoom it was given", () => {
    const state = begin({ x: 120, y: 90, pointerId: 4 }, at(40, -20, 1.5));
    expect(state).toMatchObject({
      origin: { x: 120, y: 90 },
      camera: { x: 40, y: -20, zoom: 1.5 },
      moved: false,
      pointerId: 4,
    });
  });

  it("refuses a secondary pointer", () => {
    expect(beginMiddlePan({ x: 10, y: 10, isPrimary: false }, at(0, 0, 1))).toBeNull();
  });

  it("refuses a camera and a sample it could not pan with", () => {
    expect(beginMiddlePan({ x: 10, y: 10 }, null)).toBeNull();
    expect(beginMiddlePan({ x: 10, y: 10 }, undefined)).toBeNull();
    expect(beginMiddlePan({ x: 10, y: 10 }, at(0, 0, 0))).toBeNull();
    expect(beginMiddlePan({ x: 10, y: 10 }, at(0, 0, Number.NaN))).toBeNull();
    expect(beginMiddlePan({ x: 10, y: 10 }, at(Number.POSITIVE_INFINITY, 0, 1))).toBeNull();
    expect(beginMiddlePan({ x: Number.NaN, y: 10 }, at(0, 0, 1))).toBeNull();
  });
});

describe("updateMiddlePan", () => {
  it("moves the camera opposite the pointer, so the content follows the hand", () => {
    const state = begin({ x: 100, y: 100 });
    const move = updateMiddlePan(state, { x: 140, y: 70 });
    expect(move).toEqual({
      camera: { x: -40, y: 30, zoom: 1 },
      moved: true,
    });
  });

  it("keeps the content under the pointer at any zoom, so the drag is 1:1", () => {
    const pressed = at(500, 400, 2);
    const state = begin({ x: 300, y: 300 }, pressed);
    // The world point the press landed on…
    const grabbed = worldAt(pressed, 300);

    const move = updateMiddlePan(state, { x: 400, y: 300 });
    // …is still under the pointer 100 px later, which is what 1:1 means.
    expect(worldAt(move.camera, 400)).toBeCloseTo(grabbed);
    // The camera is a world coordinate now, so the top-left moves by -delta / zoom.
    expect(move.camera.x).toBeCloseTo(500 - 100 / pressed.zoom);
  });

  it("does not pan until the press travels past the threshold", () => {
    const state = begin({ x: 0, y: 0 }, at(10, 10, 1));
    const below = updateMiddlePan(state, { x: MIDDLE_PAN_THRESHOLD - 1, y: 0 });
    expect(below).toEqual({ camera: { x: 10, y: 10, zoom: 1 }, moved: false });

    const atThreshold = updateMiddlePan(state, { x: MIDDLE_PAN_THRESHOLD, y: 0 });
    expect(atThreshold.moved).toBe(true);
    expect(atThreshold.camera.x).toBeCloseTo(10 - MIDDLE_PAN_THRESHOLD);
  });

  it("carries the whole delta once it starts, never a threshold-sized jump", () => {
    const state = begin({ x: 0, y: 0 }, at(0, 0, 1));
    const move = updateMiddlePan(state, { x: 3, y: 4 });
    // 5 px travelled: the camera moves all 5, not 5 minus the threshold.
    expect(move.camera).toEqual({ x: -3, y: -4, zoom: 1 });
  });

  it("ignores a sample that is not the pressed pointer or has no numbers", () => {
    const state = begin({ x: 0, y: 0, pointerId: 7 }, at(10, 20, 1));
    expect(updateMiddlePan(state, { x: 50, y: 50, pointerId: 8 })).toEqual({
      camera: { x: 10, y: 20, zoom: 1 },
      moved: false,
    });
    expect(updateMiddlePan(state, { x: Number.NaN, y: 50, pointerId: 7 })).toEqual({
      camera: { x: 10, y: 20, zoom: 1 },
      moved: false,
    });
    expect(updateMiddlePan(state, { x: 50, y: Number.POSITIVE_INFINITY, pointerId: 7 })).toEqual({
      camera: { x: 10, y: 20, zoom: 1 },
      moved: false,
    });
  });

  it("keeps the camera finite under a huge drag", () => {
    const state = begin({ x: 0, y: 0 }, at(0, 0, 1));
    const move = updateMiddlePan(state, { x: 1e9, y: -1e9 });
    expect(Number.isFinite(move.camera.x)).toBe(true);
    expect(Number.isFinite(move.camera.y)).toBe(true);
    expect(move.camera.zoom).toBe(1);
  });
});

describe("endMiddlePan", () => {
  it("reports a jittery press as a click and leaves the camera alone", () => {
    const state = begin({ x: 0, y: 0 }, at(10, 20, 1));
    const jitter = updateMiddlePan(state, { x: 2, y: 0 });
    expect(jitter.camera).toEqual({ x: 10, y: 20, zoom: 1 });
    expect(endMiddlePan({ ...state, moved: jitter.moved })).toEqual({ click: true });
  });

  it("reports a pan as a drag, not a click", () => {
    const state = begin({ x: 0, y: 0 });
    const move = updateMiddlePan(state, { x: 40, y: 0 });
    expect(endMiddlePan({ ...state, moved: move.moved })).toEqual({ click: false });
  });

  it("reports nothing to click when there was no press", () => {
    expect(endMiddlePan(null)).toEqual({ click: false });
    expect(endMiddlePan(undefined)).toEqual({ click: false });
  });

  it("does not drift: a press that wanders and comes back is still a click", () => {
    const pressed = at(30, 40, 1);
    const state = begin({ x: 100, y: 100 }, pressed);
    const out = updateMiddlePan(state, { x: 140, y: 100 });
    const back = updateMiddlePan({ ...state, moved: out.moved }, { x: 100, y: 100 });
    expect(back.moved).toBe(true);
    expect(back.camera).toEqual(pressed);
    // It travelled, so it is a drag: releasing at the origin must not click.
    expect(endMiddlePan({ ...state, moved: back.moved })).toEqual({ click: false });
  });

  it("leaves a cancelled drag where the last move put it", () => {
    const state = begin({ x: 0, y: 0 });
    const move = updateMiddlePan(state, { x: 60, y: 20 });
    const ended = { ...state, moved: move.moved };
    expect(endMiddlePan(ended)).toEqual({ click: false });
    // Ending is bookkeeping: the camera the caller already wrote is the truth.
    expect(updateMiddlePan(ended, { x: 60, y: 20 }).camera).toEqual(move.camera);
  });
});
