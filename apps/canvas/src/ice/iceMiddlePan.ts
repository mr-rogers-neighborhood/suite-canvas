/**
 * Middle-button panning for the ICE surface.
 *
 * ICE only reaches its `buttons & 4` check for a press that landed on the bare
 * canvas: a press captured by a widget carrying `Position` is routed as a move
 * first, so a middle drag over a card or a mat would drag it instead of
 * panning. The surface therefore takes the press in the capture phase, before
 * the desk's own listener, and drives the camera here.
 *
 * The gesture has three steps and no DOM:
 *
 * - **press** records the pointer and the camera it started from;
 * - **move** turns the pointer's travel since the press into a camera;
 * - **release** says whether the press was a click, so a middle click is not
 *   swallowed as a zero-length drag.
 *
 * Cameras are the surface's own (`cameraOf()`): `{x, y, zoom}` with
 * `world = (screen - x) / zoom`. A pointer delta is therefore already a camera
 * delta, and `x + dx` moves the content exactly as far as the hand at any
 * zoom. (The same pan is `-dx / zoom` in ICE's world-space `Camera`; the
 * division by the zoom lives in the conversion between the two, not here.)
 */

import type { FlightCamera } from "./iceCameraFlight";

/** How far a press may travel before it stops being a click. */
export const MIDDLE_PAN_THRESHOLD = 3;

/** One pointer sample, in client (screen) px. */
export interface MiddlePanPointer {
  readonly x: number;
  readonly y: number;
  readonly pointerId?: number | undefined;
  /** `PointerEvent.isPrimary`; a secondary pointer never starts a pan. */
  readonly isPrimary?: boolean | undefined;
}

/** A middle press in flight: where it began, and the camera it began on. */
export interface MiddlePanState {
  readonly pointerId: number | undefined;
  readonly origin: { readonly x: number; readonly y: number };
  readonly camera: FlightCamera;
  /** True once the press travelled far enough to be a drag. */
  readonly moved: boolean;
}

/** The camera a move asks for, and whether the press is a drag yet. */
export interface MiddlePanMove {
  readonly camera: FlightCamera;
  readonly moved: boolean;
}

export interface MiddlePanEnd {
  /** True when the press never travelled: a middle click, not a drag. */
  readonly click: boolean;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function usableCamera(camera: FlightCamera | null | undefined): camera is FlightCamera {
  return (
    camera !== null &&
    camera !== undefined &&
    finite(camera.x) &&
    finite(camera.y) &&
    finite(camera.zoom) &&
    camera.zoom > 0
  );
}

/**
 * Begin a pan at `pointer`, remembering `camera`.
 *
 * Returns null for a secondary pointer, an unusable camera or a non-finite
 * sample, so the caller never holds a state it cannot pan with.
 */
export function beginMiddlePan(
  pointer: MiddlePanPointer,
  camera: FlightCamera | null | undefined,
): MiddlePanState | null {
  if (pointer.isPrimary === false) return null;
  if (!finite(pointer.x) || !finite(pointer.y)) return null;
  if (!usableCamera(camera)) return null;
  return {
    pointerId: pointer.pointerId,
    origin: { x: pointer.x, y: pointer.y },
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
    moved: false,
  };
}

/**
 * The camera after moving to `pointer`.
 *
 * Until the press passes the threshold the camera stays exactly where it was
 * at the press, so a jittery click never nudges the board. Once it passes, the
 * camera carries the *whole* delta since the press — the threshold only
 * decides when the pan starts, it never introduces a jump.
 */
export function updateMiddlePan(state: MiddlePanState, pointer: MiddlePanPointer): MiddlePanMove {
  if (pointer.pointerId !== undefined && state.pointerId !== undefined) {
    if (pointer.pointerId !== state.pointerId) return { camera: state.camera, moved: state.moved };
  }
  if (!finite(pointer.x) || !finite(pointer.y)) {
    return { camera: state.camera, moved: state.moved };
  }
  const dx = pointer.x - state.origin.x;
  const dy = pointer.y - state.origin.y;
  const moved = state.moved || Math.hypot(dx, dy) >= MIDDLE_PAN_THRESHOLD;
  if (!moved) return { camera: state.camera, moved: false };
  return {
    camera: { x: state.camera.x + dx, y: state.camera.y + dy, zoom: state.camera.zoom },
    moved: true,
  };
}

/** End a press. A press that never travelled is a click, not a drag. */
export function endMiddlePan(state: MiddlePanState | null | undefined): MiddlePanEnd {
  return { click: state !== null && state !== undefined && !state.moved };
}
