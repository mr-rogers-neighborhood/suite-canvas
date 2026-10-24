import { describe, expect, it } from "vitest";

import type { FlightCamera } from "./iceCameraFlight";
import { type CameraSettleTimers, createCameraSettleWriter } from "./useIceCameraPersist";

/** A hand-run clock: the settle rule is about *when* it writes, so the test owns time. */
function clock() {
  let now = 0;
  let next = 0;
  const jobs = new Map<number, { at: number; run: () => void }>();
  const timers: CameraSettleTimers = {
    setTimeout: (run, ms) => {
      next += 1;
      jobs.set(next, { at: now + ms, run });
      return next as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (handle) => {
      jobs.delete(handle as unknown as number);
    },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, job] of [...jobs].sort((a, b) => a[1].at - b[1].at)) {
        if (job.at > now) continue;
        jobs.delete(id);
        job.run();
      }
    },
    pending: () => jobs.size,
  };
}

describe("camera settle writer", () => {
  it("should write once per settle, never once per sample", () => {
    const time = clock();
    let camera: FlightCamera = { x: 0, y: 0, zoom: 1 };
    const writes: string[] = [];
    const writer = createCameraSettleWriter({
      readCamera: () => camera,
      readPath: () => [],
      write: (settled) => writes.push(String(settled.x)),
      initial: null,
      timers: time.timers,
    });

    writer.sample();
    time.advance(200);
    camera = { x: 10, y: 0, zoom: 1 };
    writer.sample();
    time.advance(200);
    camera = { x: 20, y: 0, zoom: 1 };
    writer.sample();

    // 399 ms of stillness is not a settle.
    time.advance(399);
    expect(writes).toEqual([]);
    time.advance(1);
    expect(writes).toEqual(["20"]);

    // Stillness after a write writes nothing again.
    writer.sample();
    time.advance(1_000);
    expect(writes).toEqual(["20"]);
    expect(time.pending()).toBe(0);
  });

  it("should write nothing when the document already holds the camera", () => {
    const time = clock();
    const camera: FlightCamera = { x: -240, y: 96, zoom: 1.5 };
    let writes = 0;
    const writer = createCameraSettleWriter({
      readCamera: () => camera,
      readPath: () => ["board-1"],
      write: () => {
        writes += 1;
      },
      initial: { camera, path: ["board-1"] },
      timers: time.timers,
    });

    writer.sample();
    time.advance(2_000);
    expect(writes).toBe(0);
    expect(time.pending()).toBe(0);
  });

  it("should wait for a flight to land instead of writing its midpoint", () => {
    const time = clock();
    let camera: FlightCamera = { x: 0, y: 0, zoom: 1 };
    const writes: string[] = [];
    const writer = createCameraSettleWriter({
      readCamera: () => camera,
      readPath: () => [],
      write: (settled) => writes.push(String(settled.x)),
      initial: null,
      timers: time.timers,
    });

    writer.sample();
    // The flight moves after the sample, and the sample window closes on a
    // camera that is no longer where it was read.
    camera = { x: 80, y: 0, zoom: 1 };
    time.advance(400);
    expect(writes).toEqual([]);
    time.advance(400);
    expect(writes).toEqual(["80"]);
  });

  it("should not write a camera read in a frame this View does not own", () => {
    const time = clock();
    let writes = 0;
    const writer = createCameraSettleWriter({
      readCamera: () => ({ x: 1, y: 2, zoom: 1 }),
      // `null` is "the frame on screen is not this View's" — a View switch out
      // of an entered Board. Its camera is in the wrong units to store.
      readPath: () => null,
      write: () => {
        writes += 1;
      },
      initial: null,
      timers: time.timers,
    });

    writer.sample();
    time.advance(2_000);
    expect(writes).toBe(0);
  });

  it("should carry the plane pose it came from when a Board is entered", () => {
    const time = clock();
    let camera: FlightCamera = { x: 10, y: 20, zoom: 1 };
    let path: readonly string[] = [];
    const writes: { path: readonly string[]; back: FlightCamera | null }[] = [];
    const writer = createCameraSettleWriter({
      readCamera: () => camera,
      readPath: () => path,
      write: (_camera, entered, back) => writes.push({ path: entered, back }),
      initial: null,
      timers: time.timers,
    });

    writer.sample();
    time.advance(400);
    camera = { x: 300, y: 400, zoom: 2 };
    path = ["board-1"];
    writer.sample();
    time.advance(400);

    expect(writes.at(-1)).toEqual({
      path: ["board-1"],
      back: { x: 10, y: 20, zoom: 1 },
    });
  });

  it("should carry the entered Board path with the camera", () => {
    const time = clock();
    let path: readonly string[] = [];
    let written: readonly string[] | null = null;
    const writer = createCameraSettleWriter({
      readCamera: () => ({ x: 1, y: 2, zoom: 1 }),
      readPath: () => path,
      write: (_camera, entered) => {
        written = entered;
      },
      initial: null,
      timers: time.timers,
    });

    writer.sample();
    time.advance(400);
    // The plane is a path too: the first settle clears whatever was stored.
    expect(written).toEqual([]);

    path = ["board-1"];
    writer.sample();
    time.advance(400);
    expect(written).toEqual(["board-1"]);
  });
});
