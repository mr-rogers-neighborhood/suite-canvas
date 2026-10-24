/**
 * The desk's cloud dapple — the gobo plate the ICE mat is lit by (`?canvas=ice`).
 *
 * ICE lights the desk with a gobo projector: a 512² RGBA8 plate is projected across the mat and
 * graded onto everything lying on it. The engine ships the reference study's tree silhouette, whose
 * hard wedge cuts across the canvas; this module grows a plate of clouds instead — soft masses, low
 * contrast, no rim anywhere.
 *
 * The four channels are not a colour. ICE reads them as its own (mat-pass.d.ts `setPlate`):
 *
 * - **R** the silhouette, 255 = open (lit), 0 = shadow — the cloud lives here;
 * - **G** the wind's first amplitude;
 * - **B** the wind's phase;
 * - **A** the second and third amplitudes (`mat/wind.wgsl` reads `A` twice, at 2ω and 3ω).
 *
 * The wind pass adds `amp · sin(goboTime · ω + phase)` to R, so an amplitude of a few percent makes
 * a cloud's rim breathe without the mass ever hardening into a shape — the amplitude is weighted by
 * `4·d·(1−d)`, which is zero inside a mass and in clear sky and peaks on its edge.
 *
 * **Seamless.** Every octave is value noise on a lattice of `p` cells that wraps: corner indices are
 * taken modulo `p` (in both axes), and the plate is sampled at texel centres, so texel `size` is
 * texel 0 again and the projector can spill the plate past its own edge without a visible seam.
 *
 * **Pure.** A seed in, bytes out: no DOM, no ICE import, no `Math.random`.
 */

/** The plate's edge, texels — what ICE uploads (512², mat-pass.d.ts `PLATE_SIZE`). */
export const CLOUD_PLATE_SIZE = 512;

/** Largest edge a caller may ask for: past this the upload stops being a boot-time cost. */
const MAX_PLATE_SIZE = 2048;

/** Below this a cloud has no room to be a mass, so a smaller ask is raised to it. */
const MIN_PLATE_SIZE = 8;

/** Four octaves: a base mass and three scales of edge. Six is where the last octave is sub-texel. */
const DEFAULT_OCTAVES = 4;

const MAX_OCTAVES = 6;

/** Masses per plate at the first octave — four clouds across 512 texels reads as sky, not noise. */
const BASE_CELLS = 4;

/**
 * How far a dense cloud lowers the silhouette, 0..1. 0.34 leaves the thinnest shade at ~0.66 open,
 * which the lamp's own grade turns into a ~16% darkening: enough to see, too little to hurt text.
 */
const DEFAULT_CONTRAST = 0.34;

const MAX_CONTRAST = 0.6;

/** The first wind amplitude at a cloud's rim — 12% of the silhouette, so the edge stirs, not flaps. */
const WIND_AMP1 = 0.12;

/** The second and third amplitudes: half again as gentle, they only keep the first from reading as one sine. */
const WIND_AMP23 = 0.06;

/** How far the phase field swings about neutral: coherent over tens of texels, never a per-texel flare. */
const PHASE_SWING = 0.7;

export interface CloudPlateOptions {
  /** Edge in texels; default {@link CLOUD_PLATE_SIZE}. Clamped to 8…2048 and rounded. */
  readonly size?: number;
  /** The seed every lattice is drawn from; default 0. The same seed always grows the same sky. */
  readonly seed?: number;
  /** Octaves of fBm, default 4, clamped to 1…6. More octaves add smaller detail, not more cloud. */
  readonly octaves?: number;
  /** The shadow's depth, default 0.34, clamped to 0…0.6. Higher darkens the masses, never the edges. */
  readonly contrast?: number;
}

/** A resolved tuning, so the generator reads one shape. */
interface CloudPlateTuning {
  readonly size: number;
  readonly seed: number;
  readonly octaves: number;
  readonly contrast: number;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The interpolant that keeps a lattice's corners flat: no grid lines show through a mass. */
const fade = (t: number): number => t * t * (3 - 2 * t);

/** Normalised smoothstep — the soft shoulder that makes a cloud's edge a ramp, never a cut. */
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** `value` wrapped into `0…period-1`, so a lattice index is periodic in both directions. */
const wrap = (index: number, period: number): number => ((index % period) + period) % period;

/**
 * One lattice corner's value, 0..1: an integer hash, so it is identical on every machine and
 * independent of the order texels are visited in.
 */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Value noise on a `period`-cell lattice that wraps at every edge: `x` and `y` are in cells, and a
 * corner at `period` is the corner at 0 again.
 */
function tiledNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const x0 = wrap(xi, period);
  const y0 = wrap(yi, period);
  const x1 = wrap(xi + 1, period);
  const y1 = wrap(yi + 1, period);
  const bottom = lerp(hash2(x0, y0, seed), hash2(x1, y0, seed), xf);
  const top = lerp(hash2(x0, y1, seed), hash2(x1, y1, seed), xf);
  return lerp(bottom, top, yf);
}

/**
 * Fractal Brownian motion over the plate, 0..1: `octaves` lattices at 4, 8, 16… cells, each
 * wrapping, each half the weight of the one before. `u`, `v` are plate coordinates, 0..1.
 */
function fbm(u: number, v: number, octaves: number, seed: number): number {
  let sum = 0;
  let weights = 0;
  let amplitude = 1;
  let period = BASE_CELLS;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * tiledNoise(u * period, v * period, period, seed + octave * 0x9e37);
    weights += amplitude;
    amplitude *= 0.5;
    period *= 2;
  }
  return weights === 0 ? 0.5 : sum / weights;
}

function plateSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return CLOUD_PLATE_SIZE;
  return clamp(Math.round(size), MIN_PLATE_SIZE, MAX_PLATE_SIZE);
}

function plateSeed(seed: number | undefined): number {
  if (seed === undefined || !Number.isFinite(seed)) return 0;
  return Math.round(seed) >>> 0;
}

function plateOctaves(octaves: number | undefined): number {
  if (octaves === undefined || !Number.isFinite(octaves)) return DEFAULT_OCTAVES;
  return clamp(Math.round(octaves), 1, MAX_OCTAVES);
}

function plateContrast(contrast: number | undefined): number {
  if (contrast === undefined || !Number.isFinite(contrast)) return DEFAULT_CONTRAST;
  return clamp(contrast, 0, MAX_CONTRAST);
}

function tuning(options: CloudPlateOptions): CloudPlateTuning {
  return {
    size: plateSize(options.size),
    seed: plateSeed(options.seed),
    octaves: plateOctaves(options.octaves),
    contrast: plateContrast(options.contrast),
  };
}

/**
 * A `size · size · 4` RGBA8 gobo plate of clouds (see the module's header for the channels).
 *
 * Deterministic in `options` alone: the same seed and tuning grow byte-identical sky, so a boot
 * uploads the same plate every time and a test can hold a checksum against it.
 */
export function cloudPlate(options: CloudPlateOptions = {}): Uint8Array<ArrayBuffer> {
  const { size, seed, octaves, contrast } = tuning(options);
  const bytes = new Uint8Array(size * size * 4);
  const phaseSeed = (seed ^ 0x5bf03635) >>> 0;

  for (let y = 0; y < size; y += 1) {
    // Texel centres: the first and last texel of a row straddle the wrap, so the plate's edges meet
    // at the same spacing as any two texels inside it.
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const n = fbm(u, v, octaves, seed);
      // A mass's body, then its fullness: a cloud is dense at its spine and thin at its rim. The
      // window is stretched over the range fBm actually occupies, so a core can reach full density
      // and half the plate stays clear sky rather than everything sitting in a grey middle.
      const mass = smoothstep(0.26, 0.86, n);
      const spine = smoothstep(0.3, 0.95, 1 - Math.abs(2 * n - 1));
      const density = smoothstep(0.16, 0.56, mass * (0.55 + 0.45 * spine));
      // Rim weight: zero in clear sky and inside a mass, one on the edge the wind may stir.
      const rim = 4 * density * (1 - density);
      const openness = clamp01(1 - contrast * density);
      // A coarse field, not noise per texel: neighbouring texels share a phase, so the wind's sines
      // travel as one swell across a mass instead of tearing it into glitter.
      const phase = 0.5 + 0.5 * PHASE_SWING * (tiledNoise(u * 2, v * 2, 2, phaseSeed) * 2 - 1);

      const at = (y * size + x) * 4;
      bytes[at] = Math.round(openness * 255);
      bytes[at + 1] = Math.round(clamp01(WIND_AMP1 * rim) * 255);
      bytes[at + 2] = Math.round(clamp01(phase) * 255);
      bytes[at + 3] = Math.round(clamp01(WIND_AMP23 * rim) * 255);
    }
  }

  return bytes;
}

/**
 * FNV-1a over the plate, 32-bit unsigned — the look's fingerprint. A change here means the sky
 * changed, which is a decision, not a refactor.
 */
export function cloudPlateChecksum(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = Math.imul(hash ^ (bytes[i] ?? 0), 0x01000193);
  }
  return hash >>> 0;
}
