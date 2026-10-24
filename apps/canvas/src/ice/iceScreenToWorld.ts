/**
 * The live canvas camera, published by the ICE surface for the chrome.
 *
 * ICE's screen mapping is `screen = (world - camera) * zoom` in CSS px of the
 * desk container, and only the surface holds the camera. Anything that turns a
 * pointer position into a document position — a library row dropped on the
 * canvas, "New card" at the middle of the view — has to invert that mapping, or
 * the card lands wherever the camera happens to be rather than where the user
 * pointed.
 *
 * A module-level value rather than store state on purpose: the camera changes
 * every frame during a pan or a flight, and a subscriber would re-render the
 * whole shell for state that nothing but a gesture reads.
 */

export interface ScreenCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** A point in CSS px relative to the canvas element. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export const IDENTITY_CAMERA: ScreenCamera = { x: 0, y: 0, zoom: 1 };

let camera: ScreenCamera = IDENTITY_CAMERA;

/** Called by the surface; the last camera wins, and only the next gesture reads it. */
export function publishScreenCamera(next: ScreenCamera): void {
  camera =
    Number.isFinite(next.x) &&
    Number.isFinite(next.y) &&
    Number.isFinite(next.zoom) &&
    next.zoom > 0
      ? next
      : IDENTITY_CAMERA;
}

export function currentScreenCamera(): ScreenCamera {
  return camera;
}

/** The document point under a screen point, at the camera last published. */
export function screenToWorld(point: ScreenPoint, at: ScreenCamera = camera): ScreenPoint {
  return { x: point.x / at.zoom + at.x, y: point.y / at.zoom + at.y };
}
