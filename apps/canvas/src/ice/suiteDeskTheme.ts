/**
 * The desk's ground, per theme.
 *
 * The canvas opened on ICE's own mat: a green self-healing cutting mat. It is a
 * beautiful object and the wrong backdrop for a workspace — the eye reads the
 * mat as the thing, and every card and Board on top of it competes with it.
 *
 * So the desk becomes neutral: near-black in the dark theme, near-white in the
 * light one. The felt, the grain, the lattice and the rulers stay (this changes
 * two colours and how loud the grid is, not the material), and the only
 * coloured things left are the things the user put down — a card's paper and a
 * Board's accent. That is also the nudge the product wants: on a neutral desk a
 * mat is the obvious thing to lay out, so Boards become the natural first move.
 *
 * Colours are sRGB 0..1 (`RGB` in ICE's `theme.d.ts`), because that is what the
 * mat pass writes: `ground` is the mat's own colour, `ink` is its printed grid.
 */

/** The themes the app resolves to (`theme.ts` `ResolvedTheme`). */
export type SuiteDeskTheme = "light" | "dark";

/** What the desk handle needs to recolour one: `MatConfig`'s own fields. */
export interface SuiteDeskMat {
  /** The mat's colour, sRGB 0..1. */
  readonly ground: readonly [number, number, number];
  /** The printed grid and rulers, sRGB 0..1. */
  readonly ink: readonly [number, number, number];
  /** The lattice's half-widths and alphas; a dark mat needs quieter lines. */
  readonly line: {
    readonly thin: number;
    readonly thick: number;
    readonly alphaThin: number;
    readonly alphaThick: number;
  };
}

/** The narrow slice of the desk handle this needs (`configureMat`, host/layer.d.ts). */
export interface SuiteDeskSurface {
  configureMat(mat: Partial<SuiteDeskMat>): void;
}

/**
 * The two grounds.
 *
 * Neither is pure `#000` or `#fff`: a neutral with a trace of warmth still reads
 * as a *surface* rather than as a hole in the screen or a blank document, and
 * keeps the grain visible (grain on pure black or pure white is invisible).
 *
 * Both grounds obey one rule: **the desk is a surface, a card is an object on
 * it.** So the desk is always the *middle* value in its theme — a charcoal
 * (#33353a) above a dark card's `--surface: #232326`, and a warm off-white
 * below a light card's `--surface: #ffffff`. A near-black desk or a paper-white
 * one breaks that: cards become windows in the first case and disappear in the
 * second. The felt, the grain and the lattice are what keep either one reading
 * as cloth rather than as a flat colour.
 */
export const SUITE_DESK_MAT: Readonly<Record<SuiteDeskTheme, SuiteDeskMat>> = {
  dark: {
    // The night chain is a *gamma*: ICE takes this value into linear light and
    // back through the Moon's exposure, so what lands on screen is roughly its
    // square. #3c3d42 on screen therefore needs ≈ 0.5 here — the green mat read
    // at the right weight, with the hue dropped.
    ground: [0.82, 0.7, 0.56],
    ink: [1, 0.98, 0.94],
    // A lit line on a dark ground reads louder at the same alpha, so the dark
    // lattice stays quieter than the light one even with brighter ink — but it
    // is now visible: a grid you cannot see is not a felt surface, it is a fill.
    line: { thin: 0.5, thick: 1, alphaThin: 0.1, alphaThick: 0.16 },
  },
  light: {
    // ≈ #f2f1ee: the shell's `--canvas-bg: #f5f5f7` with the warmth the felt
    // wants. Brighter than the grey it replaces, and still below a card's white.
    ground: [0.949, 0.945, 0.933],
    ink: [0.2, 0.195, 0.185],
    // Louder than the dark lattice: dark ink on a light ground has more room
    // before it reads as noise, and this is where the texture carries the felt.
    line: { thin: 0.5, thick: 1, alphaThin: 0.08, alphaThick: 0.13 },
  },
};

/** The mat a theme asks for. */
export function suiteDeskMat(theme: SuiteDeskTheme): SuiteDeskMat {
  return SUITE_DESK_MAT[theme];
}

/** Recolour the desk. Cheap: `configureMat` merges into the mat's live config. */
export function applySuiteDeskTheme(desk: SuiteDeskSurface, theme: SuiteDeskTheme): void {
  desk.configureMat(suiteDeskMat(theme));
}
