/**
 * The six Board mats, measured in both themes (ADR-0043 §5).
 *
 * The mat program resolves a Board's vinyl **by name** through
 * `palette.vinyls`, so six colours can be six materials — and they now are
 * (`SUITE_BOARD_VINYL_BY_COLOR` → `SUITE_BOARD_VINYL_INKS`). What the ADR asks
 * for is the *evidence* that the six are still six after the desk is lit: two
 * Boards whose mats read the same are a rendering bug, not a palette opinion.
 *
 * WHAT IS MEASURED, AND WHAT IS NOT
 *
 * The mats are albedos: the six inks go to the mat pass, and the pass lights
 * them with the theme's own light (the Sun by day, the Moon by night). This
 * module measures the albedos — the thing the app actually chooses — in two
 * ways, and states the one property that carries the result to both themes:
 *
 * 1. **Separation.** The pairwise distance in OKLab (× 100, so ~2.3 is a
 *    just-noticeable difference for a large field, ~10 is unmistakable).
 * 2. **Value.** The pair's relative luminance. Two mats that differ only in hue
 *    can be told apart in daylight and lost at night — a night chain is steep
 *    and blue-leaning, so the ADR's rule is that the six differ in *value as
 *    well as hue*.
 *
 * The carrying property: a theme's light is a per-channel monotone map applied
 * to every mat equally (an exposure, then a curve). A monotone map cannot make
 * two different values equal, so a pair that differs in more than one channel
 * *and* in luminance survives any such light. That is the whole two-theme
 * argument, and it is why the check here is on the albedos rather than on two
 * screenshots of the GPU: `ice-lab` can photograph the light desk, and cannot
 * photograph the dark one (the runner sets no colour scheme), so a
 * screenshot-only check would be evidence for one theme and a guess for the
 * other.
 *
 * The story (`SuiteBoardMats.stories.tsx`) draws all six side by side over each
 * theme's ground with these numbers beside them, which is the picture the ADR
 * asks to record.
 */

import type { boardColors } from "@suite/graph";

import { SUITE_DESK_MAT, type SuiteDeskTheme } from "./suiteDeskTheme";
import { SUITE_BOARD_VINYL_INKS } from "./suitePen";

/** The document's Board colours, in the order the picker shows them. */
export type BoardMatColor = (typeof boardColors)[number];

/** One mat: the colour a Board stores, the vinyl it resolves to, and that vinyl's ink. */
export interface BoardMat {
  readonly color: BoardMatColor;
  readonly vinyl: keyof typeof SUITE_BOARD_VINYL_INKS;
  /** The albedo the mat pass is handed, as a CSS colour. */
  readonly ink: string;
}

/** The six, in palette order — the same order as `boardColors`. */
export const SUITE_BOARD_MATS: readonly BoardMat[] = [
  { color: "slate", vinyl: "board-slate", ink: SUITE_BOARD_VINYL_INKS["board-slate"].css },
  { color: "blue", vinyl: "board-blue", ink: SUITE_BOARD_VINYL_INKS["board-blue"].css },
  { color: "green", vinyl: "board-green", ink: SUITE_BOARD_VINYL_INKS["board-green"].css },
  { color: "amber", vinyl: "board-amber", ink: SUITE_BOARD_VINYL_INKS["board-amber"].css },
  { color: "rose", vinyl: "board-rose", ink: SUITE_BOARD_VINYL_INKS["board-rose"].css },
  { color: "violet", vinyl: "board-violet", ink: SUITE_BOARD_VINYL_INKS["board-violet"].css },
];

/**
 * The nearest two mats may be and still be two materials: OKLab ΔE × 100. The
 * floor is the tightest pair the palette already has (slate/rose), so the rule
 * is "no worse than the worst pair we shipped", not a number invented to pass.
 */
export const BOARD_MAT_MIN_DELTA_E = 7;

/** Two mats closer than this in relative luminance are the same *value*. */
export const BOARD_MAT_MIN_VALUE_STEP = 0.01;

type Rgb = readonly [number, number, number];

/** `#rrggbb` as 0..255 channels. A colour this module cannot read is black. */
export function boardMatRgb(css: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (match?.[1] === undefined) return [0, 0, 0];
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** sRGB → linear light, the transfer function the mat pass and the eye both use. */
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0..1). */
export function boardMatLuminance(css: string): number {
  const [r, g, b] = boardMatRgb(css).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** OKLab, so "different" is a perceptual statement and not an RGB one. */
export function boardMatOklab(css: string): Rgb {
  const [r8, g8, b8] = boardMatRgb(css);
  const r = linear(r8);
  const g = linear(g8);
  const b = linear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance between two colours, OKLab × 100. */
export function boardMatDistance(left: string, right: string): number {
  const a = boardMatOklab(left);
  const b = boardMatOklab(right);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

/**
 * The dark desk as it *lands*, not as it is stored.
 *
 * `SUITE_DESK_MAT.dark.ground` is the colour the night chain is handed (its
 * header: "the night chain is a gamma: ICE takes this value into linear light
 * and back through the Moon's exposure … #3c3d42 on screen therefore needs
 * ≈ 0.5 here"). A mat is compared against what a reader sees, so this is the
 * screen value the theme's own documentation names.
 */
export const SUITE_DARK_DESK_SCREEN = "#3c3d42";

/**
 * The desk a mat lies on, as the screen sees it.
 *
 * Light: the stored ground *is* its screen colour ("≈ #f2f1ee" in the theme's
 * header), so it is encoded as-is.
 */
export function boardMatGround(theme: SuiteDeskTheme): string {
  if (theme === "dark") return SUITE_DARK_DESK_SCREEN;
  const [r, g, b] = SUITE_DESK_MAT[theme].ground;
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** WCAG contrast ratio between two colours, for "does the mat read off its desk". */
export function boardMatContrast(left: string, right: string): number {
  const a = boardMatLuminance(left);
  const b = boardMatLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** One pair of mats and the two numbers that decide whether it is one material. */
export interface BoardMatPair {
  readonly left: BoardMat;
  readonly right: BoardMat;
  readonly distance: number;
  readonly valueStep: number;
}

/** All fifteen pairs, closest first — the order a reader needs them in. */
export function boardMatPairs(): readonly BoardMatPair[] {
  const pairs: BoardMatPair[] = [];
  for (let i = 0; i < SUITE_BOARD_MATS.length; i += 1) {
    for (let j = i + 1; j < SUITE_BOARD_MATS.length; j += 1) {
      const left = SUITE_BOARD_MATS[i];
      const right = SUITE_BOARD_MATS[j];
      if (left === undefined || right === undefined) continue;
      pairs.push({
        left,
        right,
        distance: boardMatDistance(left.ink, right.ink),
        valueStep: Math.abs(boardMatLuminance(left.ink) - boardMatLuminance(right.ink)),
      });
    }
  }
  return pairs.sort((a, b) => a.distance - b.distance);
}

/** What the two-theme check concluded for one theme. */
export interface BoardMatVerdict {
  readonly theme: SuiteDeskTheme;
  /** The desk colour the mats lie on, as hex. */
  readonly ground: string;
  /** The nearest pair by perceptual distance: the one that decides the verdict. */
  readonly closest: BoardMatPair;
  /** The nearest pair by luminance: the one a steep night chain would merge first. */
  readonly closestValue: BoardMatPair;
  /** The mat that sits closest to this theme's ground (the weakest separation). */
  readonly lowestContrast: { readonly mat: BoardMat; readonly contrast: number };
  /** True when every pair clears both floors — the same material test. */
  readonly distinct: boolean;
}

const FIRST_PAIR_FALLBACK: BoardMatPair = {
  left: SUITE_BOARD_MATS[0] as BoardMat,
  right: SUITE_BOARD_MATS[1] as BoardMat,
  distance: 0,
  valueStep: 0,
};

/**
 * The verdict for a theme.
 *
 * The pair tests are the ADR's: two mats with one colour make two Boards one
 * object, and the ADR's rule is that the six differ in *value as well as hue*,
 * so a pair that is only a hue apart is reported as one material however pretty
 * the hue is. The ground test is the theme's own: a mat that reads as its desk
 * is not a container, it is a smudge. All three are reported, because a palette
 * that passes one and fails another is still wrong.
 *
 * Note what is *not* claimed: the pair numbers are on the albedos, which are
 * what the app chooses, not on a screenshot of the light desk under a GPU. The
 * dark desk cannot be photographed at all in this version of the lab (`ice-lab`
 * sets no colour scheme), so the theme's contribution is measured where it can
 * be — the ground the mat lies on — and the pair test is stated as the
 * theme-invariant property it is.
 */
export function boardMatVerdict(theme: SuiteDeskTheme): BoardMatVerdict {
  const ground = boardMatGround(theme);
  const pairs = boardMatPairs();
  const closest = pairs[0] ?? FIRST_PAIR_FALLBACK;
  const closestValue =
    [...pairs].sort((a, b) => a.valueStep - b.valueStep)[0] ?? FIRST_PAIR_FALLBACK;
  let lowest = { mat: SUITE_BOARD_MATS[0] as BoardMat, contrast: Number.POSITIVE_INFINITY };
  for (const mat of SUITE_BOARD_MATS) {
    const contrast = boardMatContrast(mat.ink, ground);
    if (contrast < lowest.contrast) lowest = { mat, contrast };
  }
  return {
    theme,
    ground,
    closest,
    closestValue,
    lowestContrast: lowest,
    distinct:
      closest.distance >= BOARD_MAT_MIN_DELTA_E &&
      closestValue.valueStep >= BOARD_MAT_MIN_VALUE_STEP,
  };
}
