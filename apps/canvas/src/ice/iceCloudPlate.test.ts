import { describe, expect, it } from "vitest";
import { CLOUD_PLATE_SIZE, cloudPlate, cloudPlateChecksum } from "./iceCloudPlate";

/** The look's fingerprint: a change here changes the sky, which is a decision, not a refactor. */
const GOLDEN = 815430260;

/** A small plate for the structural checks — 512² is ~100 ms to grow and its shape is not the point. */
const SIDE = 64;

const channels = (bytes: Uint8Array, size: number) => {
  const at = (x: number, y: number, channel: number): number =>
    bytes[(y * size + x) * 4 + channel] ?? -1;
  return { at };
};

const max = (bytes: Uint8Array, channel: number): number => {
  let high = 0;
  for (let i = channel; i < bytes.length; i += 4) high = Math.max(high, bytes[i] ?? 0);
  return high;
};

const min = (bytes: Uint8Array, channel: number): number => {
  let low = 255;
  for (let i = channel; i < bytes.length; i += 4) low = Math.min(low, bytes[i] ?? 0);
  return low;
};

const mean = (bytes: Uint8Array, channel: number): number => {
  let sum = 0;
  let count = 0;
  for (let i = channel; i < bytes.length; i += 4) {
    sum += bytes[i] ?? 0;
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
};

describe("cloudPlate", () => {
  it("returns a size · size · 4 RGBA8 plate, 512² by default", () => {
    expect(CLOUD_PLATE_SIZE).toBe(512);
    expect(cloudPlate()).toHaveLength(CLOUD_PLATE_SIZE * CLOUD_PLATE_SIZE * 4);
    expect(cloudPlate({ size: SIDE })).toHaveLength(SIDE * SIDE * 4);
  });

  it("grows the same sky for the same seed, whatever ran in between", () => {
    const first = cloudPlate({ size: SIDE, seed: 41 });
    cloudPlate({ size: SIDE, seed: 42 });
    const second = cloudPlate({ size: SIDE, seed: 41 });
    expect(cloudPlateChecksum(second)).toBe(cloudPlateChecksum(first));
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it("grows a different sky for a different seed", () => {
    const one = cloudPlate({ size: SIDE, seed: 1 });
    const two = cloudPlate({ size: SIDE, seed: 2 });
    expect(cloudPlateChecksum(two)).not.toBe(cloudPlateChecksum(one));

    let differing = 0;
    for (let i = 0; i < one.length; i += 4) {
      if ((one[i] ?? 0) !== (two[i] ?? 0)) differing += 1;
    }
    // Most texels differ: a seed reshuffles the weather, it does not nudge it.
    expect(differing / (SIDE * SIDE)).toBeGreaterThan(0.5);
  });

  it("keeps the alpha ramp low and the shade in a band", () => {
    const bytes = cloudPlate({ size: SIDE, seed: 9 });

    // A (the 2ω/3ω amplitudes) only ever stirs a cloud's rim: a quarter of the channel at most.
    expect(max(bytes, 3)).toBeLessThanOrEqual(64);
    expect(mean(bytes, 3)).toBeLessThan(24);
    // G is the first amplitude: a little stronger, still never a shape of its own.
    expect(max(bytes, 1)).toBeLessThanOrEqual(96);
    // R never darkens past ~35%: the shade is a tone, not an edge.
    expect(max(bytes, 0)).toBeLessThanOrEqual(255);
    expect(mean(bytes, 0)).toBeGreaterThan(190);

    expect(min(bytes, 0)).toBeGreaterThanOrEqual(160);
  });

  it("wraps without a seam: the first column and row meet the last", () => {
    const size = 128;
    const bytes = cloudPlate({ size, seed: 3 });
    const { at } = channels(bytes, size);

    let seamSum = 0;
    let seamMax = 0;
    let interiorSum = 0;
    let interiorMax = 0;
    for (let k = 0; k < size; k += 1) {
      for (const channel of [0, 1, 2, 3]) {
        const column = Math.abs(at(0, k, channel) - at(size - 1, k, channel));
        const row = Math.abs(at(k, 0, channel) - at(k, size - 1, channel));
        seamSum += column + row;
        seamMax = Math.max(seamMax, column, row);
        const inner = Math.abs(at(k, 0, channel) - at(k + 1, 0, channel));
        interiorSum += inner;
        interiorMax = Math.max(interiorMax, inner);
      }
    }
    const seamMean = seamSum / (size * 8);
    const interiorMean = interiorSum / (size * 4);

    expect(seamMean).toBeLessThan(1.5);
    expect(seamMax).toBeLessThanOrEqual(6);
    // A wrapped edge is no rougher than the field itself is from one texel to the next.
    expect(seamMean).toBeLessThanOrEqual(interiorMean + 0.5);
    expect(seamMax).toBeLessThanOrEqual(interiorMax + 2);
  });

  it("holds the checksum golden", () => {
    expect(cloudPlateChecksum(cloudPlate())).toBe(GOLDEN);
  });

  it("clears the sky at zero contrast and deepens it as the contrast rises", () => {
    const flat = cloudPlate({ size: SIDE, seed: 5, contrast: 0 });
    expect(max(flat, 0)).toBe(255);
    expect(min(flat, 0)).toBe(255);

    const light = cloudPlate({ size: SIDE, seed: 5, contrast: 0.2 });
    const deep = cloudPlate({ size: SIDE, seed: 5, contrast: 0.5 });
    expect(mean(deep, 0)).toBeLessThan(mean(light, 0));
  });

  it("treats an unusable size or octave count as the default rather than throwing", () => {
    expect(cloudPlate({ size: Number.NaN })).toHaveLength(CLOUD_PLATE_SIZE * CLOUD_PLATE_SIZE * 4);
    expect(cloudPlate({ size: 2 })).toHaveLength(8 * 8 * 4);
    expect(cloudPlate({ size: 8, octaves: 99 })).toHaveLength(8 * 8 * 4);
  });
});
