/**
 * The View's camera, written when it settles.
 *
 * A camera is document truth, like a placement: the document keeps it per View
 * (`WorkspaceDocument.setViewCamera`), so a reload, a tab return and a second
 * client all stand where the reader left off. The engine samples its camera at
 * frame rate, so writing on every frame would be a commit per frame — instead
 * this waits for stillness: every distinct sample restarts a short timer, and
 * only the sample that is still true when the timer fires is written. One
 * commit per settle, never per frame.
 *
 * The entered Board rides along, because a camera is only meaningful in the
 * frame it was read in: the path is part of the same key and the same write.
 *
 * Nothing here holds the camera in React state or Zustand: the document owns
 * it, and the desk's own camera is the live value between settles.
 */

import { useEffect } from "react";
import type { FlightCamera } from "./iceCameraFlight";
import { enteredPathOf } from "./iceEnteredPath";
import type { IceWiring } from "./iceSurfaceWiring";

/** How still the camera has to be before it is worth a document write. */
export const CAMERA_SETTLE_MS = 400;
/** How often the engine's camera is read while looking for that stillness. */
export const CAMERA_SAMPLE_MS = 250;

export interface CameraSettleWriter {
  /** Read the camera; restart the settle timer when it (or the path) moved. */
  sample(): void;
  stop(): void;
}

export interface CameraSettleTimers {
  setTimeout: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface CameraSettleInput {
  readCamera(): FlightCamera | null;
  /**
   * The Boards entered above this View, outermost first; `null` when the frame
   * on screen is not this View's, which is not a sample worth writing.
   */
  readPath(): readonly string[] | null;
  /**
   * Write the camera and the path; `returnCamera` is the plane pose the reader
   * came from, so Escape after a reload returns to it instead of to a boot pose.
   */
  write(camera: FlightCamera, path: readonly string[], returnCamera: FlightCamera | null): void;
  /**
   * What the document already holds. Sampling that exact camera is a no-op, so
   * a mount that restored a stored camera writes nothing back.
   */
  initial: { readonly camera: FlightCamera; readonly path: readonly string[] } | null;
  delayMs?: number;
  timers?: CameraSettleTimers;
}

const keyOf = (camera: FlightCamera, path: readonly string[]): string =>
  `${camera.x}:${camera.y}:${camera.zoom}|${path.join(",")}`;

/**
 * The settle rule, with no React and no timers of its own beyond the debounce:
 * `sample()` is called by whoever owns the clock, which is what makes "one
 * write per settle" a unit test rather than a browser observation.
 */
export function createCameraSettleWriter(input: CameraSettleInput): CameraSettleWriter {
  const delay = input.delayMs ?? CAMERA_SETTLE_MS;
  const timers: CameraSettleTimers =
    input.timers ??
    ({
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => clearTimeout(handle),
    } satisfies CameraSettleTimers);
  let observed = input.initial === null ? null : keyOf(input.initial.camera, input.initial.path);
  // The last camera seen on the plane. It is the pose an entered Board returns
  // to, and the only place it can be known: once inside, the plane's frame is
  // not what the engine reads.
  let plane =
    input.initial !== null && input.initial.path.length === 0 ? input.initial.camera : null;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const sample = (): void => {
    if (stopped) return;
    const camera = input.readCamera();
    if (camera === null) return;
    const path = input.readPath();
    if (path === null) return;
    const key = keyOf(camera, path);
    if (key === observed) return;
    if (path.length === 0) plane = camera;
    observed = key;
    if (scheduled !== undefined) timers.clearTimeout(scheduled);
    scheduled = timers.setTimeout(() => {
      scheduled = undefined;
      if (stopped) return;
      // Re-read: a flight that was still moving when the timer was armed lands
      // somewhere else, and that landing deserves its own full settle.
      const settled = input.readCamera();
      if (settled === null) return;
      const settledPath = input.readPath();
      if (settledPath === null) return;
      if (keyOf(settled, settledPath) !== key) {
        observed = null;
        sample();
        return;
      }
      if (settledPath.length === 0) plane = settled;
      input.write(settled, settledPath, plane);
      observed = key;
    }, delay);
  };

  return {
    sample,
    stop: () => {
      stopped = true;
      if (scheduled !== undefined) timers.clearTimeout(scheduled);
      scheduled = undefined;
    },
  };
}

/**
 * Keep the open View's camera in the document. Mounted with the projection, so
 * it starts once the desk has a ready engine, a seed and a View — the same
 * moment every other surface hook does.
 */
export function useIceCameraPersist(wiring: IceWiring): void {
  useEffect(() => {
    const { phase, seed, workspaceMode, liveWorkspace, rootBoardId, cameraApi } = wiring;
    if (phase.kind !== "ready" || seed === null || !workspaceMode) return;
    if (liveWorkspace === null || rootBoardId === null) return;
    const view = liveWorkspace.getView(rootBoardId);
    if (view === undefined) return;
    const writer = createCameraSettleWriter({
      readCamera: () => cameraApi?.cameraOf() ?? null,
      readPath: () => {
        const path = enteredPathOf(phase.engine.world, seed.boardMats, rootBoardId);
        return path === null ? null : path.map((frame) => frame.id);
      },
      write: (camera, path, returnCamera) =>
        liveWorkspace.setViewCamera(rootBoardId, camera, path, returnCamera),
      // The document's own value: an unmoved View samples its default and
      // writes nothing, so "never moved" stays "never moved".
      initial: { camera: view.camera, path: view.path ?? [] },
    });
    const interval = setInterval(() => writer.sample(), CAMERA_SAMPLE_MS);
    return () => {
      clearInterval(interval);
      writer.stop();
    };
  }, [wiring]);
}
