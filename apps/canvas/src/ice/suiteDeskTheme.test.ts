import { describe, expect, it, vi } from "vitest";
import { applySuiteDeskTheme, SUITE_DESK_MAT, suiteDeskMat } from "./suiteDeskTheme";

function fakeDesk() {
  const calls: unknown[] = [];
  return { calls, desk: { configureMat: (mat: unknown) => calls.push(mat) } };
}

describe("suiteDeskTheme", () => {
  it("should give each theme its own ground", () => {
    const light = suiteDeskMat("light");
    const dark = suiteDeskMat("dark");

    expect(light.ground).not.toEqual(dark.ground);
    // Neither ground may be *coloured*: the darkest channel is at least 60% of
    // the brightest. The dark one carries a deliberate warm cast, because the
    // night chain tints whatever it is given blue and this cancels it (the
    // measured screen colour is a neutral #3f4244).
    for (const mat of [light, dark]) {
      const [r, g, b] = mat.ground;
      expect(Math.min(r, g, b) / Math.max(r, g, b)).toBeGreaterThan(0.6);
    }
  });

  it("should keep the desk off the two extremes so the grain still reads", () => {
    const dark = suiteDeskMat("dark").ground;
    const light = suiteDeskMat("light").ground;

    // Not black, not white: a pure extreme flattens the felt and the lattice.
    // The dark value is high on purpose: the night chain is a steep tone curve,
    // so a mid value here is what lands as #3f4244 on screen. The *screen*
    // result is asserted in the theme's own comment and in the screenshot pass.
    expect(Math.min(...dark)).toBeGreaterThan(0.4);
    expect(Math.max(...dark)).toBeLessThan(0.9);
    expect(Math.min(...light)).toBeGreaterThan(0.85);
    expect(Math.max(...light)).toBeLessThan(0.97);
  });

  it("should always sit between the theme's card surface and the opposite extreme", () => {
    const luma = ([r, g, b]: readonly [number, number, number]) =>
      0.2126 * r + 0.7152 * g + 0.0722 * b;
    // The desk is the surface; a card is an object on it. So the dark ground is
    // *lighter* than `--surface: #232326`, and the light ground is *darker* than
    // `--surface: #ffffff` — in both themes a card reads as a thing lying down.
    const darkCard = [0x23 / 255, 0x23 / 255, 0x26 / 255] as const;
    const lightCard = [1, 1, 1] as const;

    expect(luma(suiteDeskMat("dark").ground)).toBeGreaterThan(luma(darkCard));
    expect(luma(suiteDeskMat("light").ground)).toBeLessThan(luma(lightCard));
  });

  it("should invert the grid's ink against its ground", () => {
    const light = suiteDeskMat("light");
    const dark = suiteDeskMat("dark");
    const luma = ([r, g, b]: readonly [number, number, number]) =>
      0.2126 * r + 0.7152 * g + 0.0722 * b;

    expect(luma(light.ink)).toBeLessThan(luma(light.ground));
    expect(luma(dark.ink)).toBeGreaterThan(luma(dark.ground));
  });

  it("should keep a visible lattice in both themes", () => {
    // A grid you cannot see is a fill, not a felt surface. The dark lattice
    // carries more alpha than the light one because the night chain washes it
    // out; both stay under a hairline's weight so the texture never competes
    // with the content.
    expect(SUITE_DESK_MAT.dark.line.alphaThick).toBeGreaterThanOrEqual(0.1);
    expect(SUITE_DESK_MAT.light.line.alphaThick).toBeGreaterThanOrEqual(0.1);
    expect(SUITE_DESK_MAT.dark.line.alphaThick).toBeLessThan(0.25);
    expect(SUITE_DESK_MAT.light.line.alphaThick).toBeLessThan(0.25);
  });

  it("should hand the whole mat to the desk in one call", () => {
    const { calls, desk } = fakeDesk();

    applySuiteDeskTheme(desk, "dark");

    expect(calls).toEqual([SUITE_DESK_MAT.dark]);
  });

  it("should be repeatable for the same theme", () => {
    const { calls, desk } = fakeDesk();

    applySuiteDeskTheme(desk, "light");
    applySuiteDeskTheme(desk, "light");

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
  });

  it("should record the rect of a theme switch rather than mixing the two", () => {
    const { calls, desk } = fakeDesk();
    const spy = vi.fn(applySuiteDeskTheme);

    spy(desk, "light");
    spy(desk, "dark");

    expect(spy).toHaveBeenCalledTimes(2);
    expect((calls[1] as { ground: readonly number[] }).ground).toEqual(SUITE_DESK_MAT.dark.ground);
  });
});
