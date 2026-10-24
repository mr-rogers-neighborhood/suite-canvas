/**
 * Suite's desk light — the cloud gobo and the pace it drifts at.
 *
 * ICE lights the desk with a gobo projector whose plate covers the whole mat, cards included. Its
 * default plate is the reference study's tree: the hard wedge across the upper right of the canvas,
 * and a shadow that moves at the engine's own wind (5 gobo-seconds per second, so a leaf's sway
 * cycles in about a second). This module replaces both, as data plus one function:
 *
 * - the plate is ours (`iceCloudPlate.ts`), a soft, low-contrast sky;
 * - the grade is turned down until the shade can only ever be a passing cloud;
 * - the clock is asked for {@link SUITE_GOBO.wind}, which is slow enough that one swell takes about a
 *   minute to cross the viewport.
 *
 * No per-frame JavaScript: the wind is the desk's own clock (`Ambient`), so the drift costs the
 * engine's one 512² wind dispatch and nothing of ours.
 */

import { type CloudPlateOptions, cloudPlate } from "./iceCloudPlate";

/** The 512² plate is ~100 ms to grow, so the default one is grown once and shared by every desk. */
let defaultPlate: Uint8Array<ArrayBuffer> | null = null;

function suitePlate(options: CloudPlateOptions | undefined): Uint8Array<ArrayBuffer> {
  if (options !== undefined) return cloudPlate(options);
  defaultPlate ??= cloudPlate();
  return defaultPlate;
}

/** ICE's two plate slots (`PlateName`, mat/layout.d.ts). */
export type SuitePlateSlot = "c" | "b";

/** The gobo's tuning, as ICE's `MatConfig.gobo` reads it (mat/layout.d.ts). */
export interface SuiteGoboConfig {
  readonly opacity: number;
  readonly blurTexels: number;
  readonly shadeMix: number;
  readonly darkFloor: number;
  readonly saturate: number;
  readonly sharp: number;
  readonly soft: number;
  readonly plate: SuitePlateSlot;
}

/** The mat's config over the current one — only the gobo is ours (`configureMat`, host/layer.d.ts). */
export interface SuiteMatPatch {
  readonly gobo: SuiteGoboConfig;
}

/** What we need of the desk's `Ambient`: whether the OS asked for reduced motion (compose/ambient.d.ts). */
export interface SuiteDeskAmbient {
  state(): { readonly reducedMotion: boolean };
}

/**
 * The narrowest structural type the configuration needs — the four doors of the desk's handle
 * (`DeskLayerHandle`, host/layer.d.ts) that a lighting change may use. `ambient`/`setAmbient`/
 * `pinMat` are optional so a two-method fake still stands in for the desk.
 */
export interface SuiteAmbientDesk {
  /** A 512² RGBA8 plate into slot `c` or `b`. */
  setPlate(name: SuitePlateSlot, bytes: Uint8Array<ArrayBuffer>): void;
  /** The mat's config over the current one; the handle merges `gobo` field by field. */
  configureMat(mat: SuiteMatPatch): void;
  /** The drift's rate, 0 = a still (`MatPin.wind`): 0 pins the clock, anything above it lets it blow. */
  pinMat?(pin: { readonly wind: number } | null): void;
  /** The ambient policy: `live` keeps the wind blowing with no input, `still` stops the clocks. */
  setAmbient?(mode: "live" | "idle" | "still", idleMs?: number): void;
  /** The desk's own ambient, which already carries the OS's reduced-motion answer. */
  ambient?(): SuiteDeskAmbient;
}

/**
 * The gobo, as constants.
 *
 * The shade the lamp grades on is `mix(1, darkFloor + (1 − darkFloor)·g, shadeMix)` where
 * `g = mix(1, plate.R, opacity)`; with these numbers a full cloud lands at ≈ 0.83 — a 17% darkening,
 * so a card's text keeps 83% of its contrast at the darkest point of the sky and the eye reads a
 * change of tone rather than an edge.
 */
export const SUITE_GOBO = {
  /** Slot `c`: it is the theme's own slot, and its wind strength (0.388) is the calmer of the two. */
  plate: "c",
  /** The whole plate: the contrast lives in the sky it draws, not in a halfway blend. */
  opacity: 1,
  /** 4 texels, twice the theme's 2: the large plate is blurred so no texel-scale structure survives. */
  blurTexels: 4,
  /** 0.97, the theme's own: a cloud is a dimming of the paper, not a tint of it. */
  shadeMix: 0.97,
  /** 0.5: the darkest a cloud may take the paper, so text keeps half its contrast even under one. */
  darkFloor: 0.5,
  /** 0.06, half the theme's 0.1: shade desaturates the paper less, so text stays neutral, not blue. */
  saturate: 0.06,
  /** 0.32 m, inside the theme's 0.373: past this depth the plate is already fully softened. */
  sharp: 0.32,
  /** 0.65 m, inside the theme's 0.791: the whole desk sits past the sharp end, so no patch sharpens. */
  soft: 0.65,
  /**
   * Gobo-seconds per second, where the theme asks 5. At 0.08 the wind's first sine cycles in ~78 s
   * and the third in ~26 s: a swell crosses the viewport on the order of a minute, not seconds.
   *
   * ICE 0.16.0 gives a host no door to the rate itself — its `Ambient` captures
   * `MAT_GRID.gobo.wind` (5) when the layer mounts, and `configureMat` has no `wind` field. What the
   * handle does take is the engine's own still-or-blow flag (`MatPin.wind`: 0 = a still, above it
   * the wind blows), so this is the pace we ask for; while the rate is not ours, the plate's G/A wind
   * amplitudes (12% and 6% of the silhouette, on rims only) are what keep the blowing calm.
   */
  wind: 0.08,
} as const;

/** Where the plate comes from — the defaults are the look; a test may ask for a tiny seeded plate. */
export interface SuiteAmbientOptions {
  readonly plate?: CloudPlateOptions;
}

/** The ambient mode that lets the drift run, and the one that holds it still. */
const AMBIENT_DRIFTING = "live";
const AMBIENT_STILL = "still";

type DriftPhase = "drifting" | "still";

/** The plate and the grade land once per desk; the drift may be restated when the OS preference moves. */
const applied = new WeakSet<object>();
const drift = new WeakMap<object, DriftPhase>();

/**
 * Light the desk with Suite's clouds: upload the plate once, point the gobo at it, and set the pace.
 *
 * The plate and the grade are applied the first time only; the drift knobs are re-stated only when
 * the reduced-motion answer changes, so a second call with the same state records nothing (and a
 * host may safely call this again when `prefers-reduced-motion` moves).
 *
 * **Reduced motion.** The desk's own `Ambient` reports it (`Ambient.state().reducedMotion`): the host
 * mounts `matchMedia("(prefers-reduced-motion: reduce)")` into it, and its `effectiveMode()` is
 * `still` while it is true. We read that answer rather than the media query — one source, no second
 * `matchMedia` — and ask for no wind at all: `pinMat({ wind: 0 })` pins the clocks and
 * `setAmbient("still")` keeps the wind pass from running, so the plate is uploaded and lit exactly
 * as it is when drifting, and only the clock is held. Nothing else about the lighting changes.
 */
/**
 * The sky we grow: three octaves and the generator's deepest contrast. Fewer,
 * larger masses than the defaults — a big cloud drifting at the engine's fixed
 * rate reads as slow, where small puffs at the same rate read as weather.
 */
const SUITE_PLATE: CloudPlateOptions = { octaves: 3, contrast: 0.6 };

export function applySuiteAmbient(desk: SuiteAmbientDesk, options: SuiteAmbientOptions = {}): void {
  const reducedMotion = desk.ambient?.()?.state?.().reducedMotion === true;
  const { wind, ...gobo } = SUITE_GOBO;

  if (!applied.has(desk)) {
    applied.add(desk);
    desk.setPlate(SUITE_GOBO.plate, suitePlate(options.plate ?? SUITE_PLATE));
    desk.configureMat({ gobo });
  }

  const phase: DriftPhase = reducedMotion || wind <= 0 ? "still" : "drifting";
  if (drift.get(desk) === phase) return;
  drift.set(desk, phase);
  const rate = phase === "still" ? 0 : wind;
  desk.pinMat?.({ wind: rate });
  desk.setAmbient?.(phase === "still" ? AMBIENT_STILL : AMBIENT_DRIFTING);
}
