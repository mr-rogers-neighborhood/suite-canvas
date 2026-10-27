import { z } from "zod";

/**
 * The paint system's vocabulary (ADR-0051).
 *
 * Every paintable thing is a *surface* with four edges, and one optional
 * `SurfaceStyle` record styles them all. A style names roles, never values: the
 * theme resolves a role to a colour, so one rule repaints every surface without
 * anyone storing a hex string in the document.
 */

/**
 * Colour roles a style may name. They match the token names the shell already
 * reads (`--surface`, `--ink`, `--hairline`, …), so a new theme is a new set of
 * values rather than a new vocabulary.
 */
export const styleColourRoles = [
  "canvas",
  "surface",
  "surface-strong",
  "ink",
  "ink-muted",
  "hairline",
  "accent",
  "danger",
  "success",
  "warning",
] as const;
export type StyleColourRole = (typeof styleColourRoles)[number];

/** The silhouettes a surface can wear. Paint only: never structure (ADR-0051 §7). */
export const styleShapes = [
  "rect",
  "pill",
  "diamond",
  "parallelogram",
  "circle",
  "document",
  "database",
  "hexagon",
] as const;
export type StyleShape = (typeof styleShapes)[number];

export const styleEdgePaints = ["solid", "dashed", "dotted", "none"] as const;
export type StyleEdgePaint = (typeof styleEdgePaints)[number];

/** Dash animation. `forward` follows the surface's own geometry; `reverse` is the exception. */
export const styleEdgeFlows = ["none", "forward", "reverse"] as const;
export type StyleEdgeFlow = (typeof styleEdgeFlows)[number];

export const styleSides = ["top", "right", "bottom", "left"] as const;
export type StyleSide = (typeof styleSides)[number];

/**
 * The lowest opacity a style may ask for. A card the owner cannot see is a card
 * a collaborator cannot see either, so the floor is a constant rather than a
 * per-style choice; hovering or selecting restores full opacity for the reader
 * (ADR-0051 §5).
 */
export const OPACITY_FLOOR = 0.25;

/** Text scale is relative to the surface's own default, and bounded both ways. */
export const TEXT_SCALE_MIN = 0.6;
export const TEXT_SCALE_MAX = 2.5;

export const edgeStyleSchema = z.object({
  paint: z.enum(styleEdgePaints),
  width: z.number().positive().max(12).optional(),
  colour: z.enum(styleColourRoles).optional(),
  flow: z.enum(styleEdgeFlows).optional(),
  /** Seconds per dash cycle; slower reads as calmer. */
  speed: z.number().positive().max(20).optional(),
});
export type EdgeStyle = z.infer<typeof edgeStyleSchema>;

/** Per-side overrides. `exactOptionalPropertyTypes` is on, so each side names `undefined`. */
export interface SurfaceSides {
  top?: EdgeStyle | undefined;
  right?: EdgeStyle | undefined;
  bottom?: EdgeStyle | undefined;
  left?: EdgeStyle | undefined;
}

/**
 * WCAG relative luminance for a hex colour, or null when it is not one the eye can
 * be measured against (an `rgba()`, a `color-mix()`).
 */
function luminance(colour: string): number | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  const channel = (offset: number): number => {
    const value = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** The contrast between two colours, or null when either is not a hex value. */
export function contrastRatio(background: string, ink: string): number | null {
  const a = luminance(background);
  const b = luminance(ink);
  if (a === null || b === null) return null;
  const [high, low] = a >= b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

/**
 * The ratio every painted pair has to clear: WCAG's for large text and graphical
 * objects. Below it a reader is being asked to read something they cannot.
 */
export const CONTRAST_FLOOR = 3;

/**
 * The ink a colour can carry, from the roles a theme defines.
 *
 * Preference order, not highest ratio: a reader expects text to be `ink`, so the
 * first candidate that clears the floor wins and a 19:1 pairing the theme never
 * intends does not beat a sensible one. When nothing clears it, the best
 * available is returned with its ratio, so the caller can say so rather than
 * pretend.
 */
export const INK_CANDIDATES: readonly StyleColourRole[] = [
  "ink",
  "surface-strong",
  "canvas",
  "surface",
  "ink-muted",
  "accent",
];

export function pickInk(
  colour: string,
  roles: Readonly<Partial<Record<StyleColourRole, string>>>,
): { ink: StyleColourRole; ratio: number } | null {
  let best: { ink: StyleColourRole; ratio: number } | null = null;
  for (const candidate of INK_CANDIDATES) {
    const value = roles[candidate];
    if (!value) continue;
    const ratio = contrastRatio(colour, value);
    if (ratio === null) continue;
    if (ratio >= CONTRAST_FLOOR) return { ink: candidate, ratio };
    if (best === null || ratio > best.ratio) best = { ink: candidate, ratio };
  }
  return best;
}

/**
 * One entry in the workspace palette: a name the reader wrote, and the colour it
 * resolves to in each mode.
 *
 * Per mode rather than one value, because a workspace has to look like itself at
 * both brightnesses. The two are stored together so a swatch cannot be defined in
 * light and undefined in dark, which is what one value plus a "same as light"
 * fallback eventually produces.
 */
export const paletteSwatchSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(40),
  light: z.string().min(1).max(120),
  dark: z.string().min(1).max(120),
  /**
   * The ink that reads on this colour, per mode. Stored beside the colour rather
   * than derived at paint time: the theme's values can move, and a swatch whose
   * ink was chosen against last year's palette is still the ink its author saw.
   */
  inkLight: z.enum(styleColourRoles),
  inkDark: z.enum(styleColourRoles),
});
export type PaletteSwatch = z.infer<typeof paletteSwatchSchema>;

/**
 * The palette a workspace starts with. Six colours, the same six a section can be,
 * so "blue" means one blue across the product and a reader who has never opened
 * Settings still has something to click.
 */
export const DEFAULT_PALETTE: readonly PaletteSwatch[] = [
  {
    id: "slate",
    name: "Slate",
    light: "#64748b",
    dark: "#94a3b8",
    inkLight: "ink",
    inkDark: "surface-strong",
  },
  {
    id: "blue",
    name: "Blue",
    light: "#3b82f6",
    dark: "#60a5fa",
    inkLight: "ink",
    inkDark: "surface-strong",
  },
  {
    id: "green",
    name: "Green",
    light: "#10b981",
    dark: "#34d399",
    inkLight: "ink",
    inkDark: "surface-strong",
  },
  {
    id: "amber",
    name: "Amber",
    light: "#f59e0b",
    dark: "#fbbf24",
    inkLight: "ink",
    inkDark: "surface-strong",
  },
  {
    id: "rose",
    name: "Rose",
    light: "#f43f5e",
    dark: "#fb7185",
    inkLight: "ink",
    inkDark: "surface-strong",
  },
  {
    id: "violet",
    name: "Violet",
    light: "#8b5cf6",
    dark: "#a78bfa",
    inkLight: "ink",
    inkDark: "surface-strong",
  },
];

/** The colour a swatch resolves to in one mode, or null when the id names nothing. */
export function swatchColour(
  palette: readonly PaletteSwatch[],
  id: string | undefined,
  mode: "light" | "dark",
): string | null {
  if (!id) return null;
  const swatch = palette.find((entry) => entry.id === id);
  return swatch ? swatch[mode] : null;
}

/** The ink that reads on a swatch in one mode, or null when the id names nothing. */
export function swatchInk(
  palette: readonly PaletteSwatch[],
  id: string | undefined,
  mode: "light" | "dark",
): StyleColourRole | null {
  if (!id) return null;
  const swatch = palette.find((entry) => entry.id === id);
  return swatch ? (mode === "dark" ? swatch.inkDark : swatch.inkLight) : null;
}

export const surfaceStyleSchema = z.object({
  /**
   * A palette swatch, by id. This is the fill a reader chooses, and it wins over
   * `surface` when both are present.
   */
  swatch: z.string().min(1).max(80).optional(),
  /** A role, or `none` for a seamless surface: bare content on the canvas. */
  surface: z.union([z.enum(styleColourRoles), z.literal("none")]).optional(),
  ink: z.enum(styleColourRoles).optional(),
  shape: z.enum(styleShapes).optional(),
  radius: z.number().min(0).max(999).optional(),
  /** Only the sides that differ from the inherited style are written. */
  sides: z
    .object({
      top: edgeStyleSchema.optional(),
      right: edgeStyleSchema.optional(),
      bottom: edgeStyleSchema.optional(),
      left: edgeStyleSchema.optional(),
    })
    .optional(),
  opacity: z.number().min(OPACITY_FLOOR).max(1).optional(),
  textScale: z.number().min(TEXT_SCALE_MIN).max(TEXT_SCALE_MAX).optional(),
  /** A style value, never markup (ADR-0046 §7). */
  icon: z.string().min(1).max(120).optional(),
});
export type SurfaceStyle = z.infer<typeof surfaceStyleSchema>;

/**
 * The style actually painted: the record with every absent field resolved to
 * the surface's default. Painters take this, never the raw record, so no
 * component has to repeat a fallback.
 */
export interface ResolvedSurfaceStyle {
  surface: StyleColourRole | "none";
  ink: StyleColourRole;
  shape: StyleShape;
  radius: number | null;
  sides: SurfaceSides;
  opacity: number;
  textScale: number;
  icon: string | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A style clamped into the legal range, so a hand-edited document cannot go invisible. */
export function clampStyle(style: SurfaceStyle): SurfaceStyle {
  const clamped: SurfaceStyle = { ...style };
  if (clamped.opacity !== undefined) {
    clamped.opacity = clamp(clamped.opacity, OPACITY_FLOOR, 1);
  }
  if (clamped.textScale !== undefined) {
    clamped.textScale = clamp(clamped.textScale, TEXT_SCALE_MIN, TEXT_SCALE_MAX);
  }
  return clamped;
}

/**
 * The default a given surface paints when no style is stored. Cards and fields
 * sit on the surface role; a section and the canvas are their own paints; a link
 * is an accent stroke with no fill.
 */
export function resolveSurfaceStyle(
  style: SurfaceStyle | undefined,
  surface: "card" | "section" | "board" | "field" | "link" | "shell",
): ResolvedSurfaceStyle {
  const base: ResolvedSurfaceStyle = {
    surface: surface === "board" ? "canvas" : surface === "link" ? "none" : "surface",
    ink: surface === "link" ? "accent" : "ink",
    shape: "rect",
    radius: null,
    sides: {},
    opacity: 1,
    textScale: 1,
    icon: null,
  };
  if (!style) return base;
  const clamped = clampStyle(style);
  return {
    surface: clamped.surface ?? base.surface,
    ink: clamped.ink ?? base.ink,
    shape: clamped.shape ?? base.shape,
    radius: clamped.radius ?? base.radius,
    sides: clamped.sides ?? base.sides,
    opacity: clamped.opacity ?? base.opacity,
    textScale: clamped.textScale ?? base.textScale,
    icon: clamped.icon ?? base.icon,
  };
}

/**
 * The direction a dashed edge travels when the style does not say: a box runs
 * clockwise from its top edge, a link runs from its source to its target. Two
 * edges animating opposite ways by accident is how a board starts to look
 * broken, so the default is the surface's own geometry (ADR-0051 §6).
 */
export function defaultEdgeFlow(side: StyleSide | "link"): StyleEdgeFlow {
  if (side === "link") return "forward";
  return side === "top" || side === "right" ? "forward" : "reverse";
}

/** The style a side paints: its own value, or the surface's shared edge style. */
export function sideEdgeStyle(
  resolved: ResolvedSurfaceStyle,
  side: StyleSide,
): EdgeStyle | undefined {
  return resolved.sides[side];
}

/** True when a style changes anything at all, so callers can drop an empty record. */
export function isEmptyStyle(style: SurfaceStyle | undefined): boolean {
  if (!style) return true;
  return (
    style.swatch === undefined &&
    style.surface === undefined &&
    style.ink === undefined &&
    style.shape === undefined &&
    style.radius === undefined &&
    style.opacity === undefined &&
    style.textScale === undefined &&
    style.icon === undefined &&
    (style.sides === undefined || Object.keys(style.sides).length === 0)
  );
}
