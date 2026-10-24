import type { DeskLayerHandle } from "@vibecook/ice/desk";
import { describe, expect, it } from "vitest";

import {
  applySuiteAmbient,
  SUITE_GOBO,
  type SuiteAmbientDesk,
  type SuiteMatPatch,
} from "./iceAmbient";
import { cloudPlate, cloudPlateChecksum } from "./iceCloudPlate";

/** A tiny plate keeps the tests quick; the shape of the call is what they hold. */
const PLATE = { size: 32, seed: 11 } as const;

interface Call {
  readonly call: string;
  readonly args: readonly unknown[];
}

function fakeDesk(reducedMotion = false) {
  const calls: Call[] = [];
  let reduced = reducedMotion;
  const desk: SuiteAmbientDesk = {
    setPlate: (name, bytes) => calls.push({ call: "setPlate", args: [name, bytes] }),
    configureMat: (mat) => calls.push({ call: "configureMat", args: [mat] }),
    pinMat: (pin) => calls.push({ call: "pinMat", args: [pin] }),
    setAmbient: (mode, idleMs) => calls.push({ call: "setAmbient", args: [mode, idleMs] }),
    ambient: () => ({ state: () => ({ reducedMotion: reduced }) }),
  };
  return {
    desk,
    calls,
    names: () => calls.map((entry) => entry.call),
    setReducedMotion: (value: boolean) => {
      reduced = value;
    },
  };
}

const goboOf = (calls: readonly Call[]): SuiteMatPatch["gobo"] => {
  const configure = calls.find((entry) => entry.call === "configureMat");
  const patch = configure?.args[0] as SuiteMatPatch | undefined;
  if (patch === undefined) throw new Error("no configureMat call was recorded");
  return patch.gobo;
};

const driftOf = (calls: readonly Call[]) =>
  calls
    .filter((entry) => entry.call === "pinMat" || entry.call === "setAmbient")
    .map((entry) => ({ call: entry.call, args: entry.args }));

describe("applySuiteAmbient", () => {
  it("uploads the cloud plate once into the slot the gobo points at", () => {
    const fake = fakeDesk();
    applySuiteAmbient(fake.desk, { plate: PLATE });

    expect(fake.names().filter((name) => name === "setPlate")).toHaveLength(1);
    const upload = fake.calls.find((entry) => entry.call === "setPlate");
    expect(upload?.args[0]).toBe(SUITE_GOBO.plate);
    expect(upload?.args[0]).toBe("c");
    const bytes = upload?.args[1] as Uint8Array;
    expect(bytes).toHaveLength(PLATE.size * PLATE.size * 4);
    expect(cloudPlateChecksum(bytes)).toBe(cloudPlateChecksum(cloudPlate(PLATE)));

    const gobo = goboOf(fake.calls);
    expect(gobo.plate).toBe("c");
    expect(gobo).not.toHaveProperty("wind");
  });

  it("configures exactly the constants, and nothing else", () => {
    const fake = fakeDesk();
    applySuiteAmbient(fake.desk, { plate: PLATE });

    expect(fake.names().filter((name) => name === "configureMat")).toHaveLength(1);
    // `wind` is the clock's, not the mat's: it must not leak into the mat config.
    const { plate, opacity, blurTexels, shadeMix, darkFloor, saturate, sharp, soft } = SUITE_GOBO;
    expect(goboOf(fake.calls)).toEqual({
      plate,
      opacity,
      blurTexels,
      shadeMix,
      darkFloor,
      saturate,
      sharp,
      soft,
    });
  });

  it("lets the wind blow while the user is still", () => {
    const fake = fakeDesk();
    applySuiteAmbient(fake.desk, { plate: PLATE });

    expect(driftOf(fake.calls)).toEqual([
      { call: "pinMat", args: [{ wind: SUITE_GOBO.wind }] },
      { call: "setAmbient", args: ["live", undefined] },
    ]);
    expect(SUITE_GOBO.wind).toBeGreaterThan(0);
    expect(SUITE_GOBO.wind).toBeLessThan(0.2);
  });

  it("holds the clock still under reduced motion and changes nothing else", () => {
    const drifting = fakeDesk(false);
    const still = fakeDesk(true);
    applySuiteAmbient(drifting.desk, { plate: PLATE });
    applySuiteAmbient(still.desk, { plate: PLATE });

    // The plate and the grade are the same lighting in both cases — only the clock is held.
    const upload = (calls: readonly Call[]) => {
      const entry = calls.find((call) => call.call === "setPlate");
      return { slot: entry?.args[0], checksum: cloudPlateChecksum(entry?.args[1] as Uint8Array) };
    };
    expect(upload(still.calls)).toEqual(upload(drifting.calls));
    expect(goboOf(still.calls)).toEqual(goboOf(drifting.calls));

    expect(driftOf(still.calls)).toEqual([
      { call: "pinMat", args: [{ wind: 0 }] },
      { call: "setAmbient", args: ["still", undefined] },
    ]);
    // The only values that move are the drift's.
    expect(driftOf(still.calls)).not.toEqual(driftOf(drifting.calls));
  });

  it("is idempotent: a second call with the same state records nothing", () => {
    const fake = fakeDesk();
    applySuiteAmbient(fake.desk, { plate: PLATE });
    const first = fake.calls.map((entry) => ({ call: entry.call, args: entry.args }));

    applySuiteAmbient(fake.desk, { plate: PLATE });

    expect(fake.calls).toHaveLength(first.length);
    expect(fake.names()).toEqual(["setPlate", "configureMat", "pinMat", "setAmbient"]);
  });

  it("restates only the drift when the OS preference moves", () => {
    const fake = fakeDesk();
    applySuiteAmbient(fake.desk, { plate: PLATE });
    const before = fake.calls.length;

    fake.setReducedMotion(true);
    applySuiteAmbient(fake.desk, { plate: PLATE });

    const added = fake.calls.slice(before);
    expect(added.map((entry) => entry.call)).toEqual(["pinMat", "setAmbient"]);
    expect(added[0]?.args).toEqual([{ wind: 0 }]);
    expect(added[1]?.args).toEqual(["still", undefined]);

    // And back again, without re-uploading the plate.
    fake.setReducedMotion(false);
    applySuiteAmbient(fake.desk, { plate: PLATE });
    expect(fake.calls.filter((entry) => entry.call === "setPlate")).toHaveLength(1);
    expect(fake.calls.at(-1)?.args).toEqual(["live", undefined]);
  });

  it("works on a desk that offers no ambient door, and does not throw without pinMat", () => {
    const calls: string[] = [];
    const bare = {
      setPlate: () => calls.push("setPlate"),
      configureMat: () => calls.push("configureMat"),
    };
    expect(() => applySuiteAmbient(bare, { plate: PLATE })).not.toThrow();
    expect(calls).toEqual(["setPlate", "configureMat"]);
  });

  it("accepts the real desk handle: the structural type is the handle's own doors", () => {
    const acceptsHandle = (handle: DeskLayerHandle): void => applySuiteAmbient(handle);
    expect(typeof acceptsHandle).toBe("function");
  });
});
