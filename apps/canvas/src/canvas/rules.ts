import {
  type ResolvedSurfaceStyle,
  resolveSurfaceStyle,
  type StyleColourRole,
  type SurfaceStyle,
  styleColourRoles,
} from "@suite/graph";
import { colourRoleVar, surfacePaintVars } from "./surfacePaint";

/**
 * A surface's paint, from two levels and no more.
 *
 * A card wears its type's style, then its own over that. A link wears its own. A
 * section, a board and a field wear the theme, which is what the theme is for.
 *
 * There are no rules, no scopes and no shell paint. Every one of those was a way
 * to say "paint that thing over there", and the thing a reader wanted was always
 * the same: this card, or every card of this type.
 */

/**
 * The readability floor (ADR-0046 §6).
 * WCAG's ratio for large text and graphical objects. A pair below it is corrected
 * and reported, never applied silently. It lives here rather than in `@suite/graph`
 * because only the resolver reads it.
 */
export const CONTRAST_FLOOR = 3;

/** The surface a style is resolved for. */
export interface SurfaceSubject {
  surface: "card" | "section" | "board" | "field" | "link" | "shell";
}

/**
 * Role → the colour the token layer resolves it to, as `#rrggbb`. The guard needs
 * numbers, and the app reads this from the live token layer rather than keeping a
 * second palette (ADR-0046 §1).
 */
export type SurfacePalette = Partial<Record<StyleColourRole, string>>;

/** A pair that would have been unreadable, and the ink the floor chose instead. */
export interface ContrastCorrection {
  /** Always null now: only a surface's own style can be corrected. */
  ruleId: string | null;
  surface: StyleColourRole | "none";
  ink: StyleColourRole;
  corrected: StyleColourRole;
  ratio: number;
  floor: number;
}

export interface RuleResolution {
  style: ResolvedSurfaceStyle;
  /** The style as written, the two levels merged, before the defaults. */
  declared: SurfaceStyle;
  /** True when either level named this surface. */
  applied: boolean;
  /** Non-empty when the floor had to correct a pair. Show it; do not drop it. */
  corrections: ContrastCorrection[];
}

/** One style laid over another; per-side edges merge per field, not per side. */
export function mergeSurfaceStyle(base: SurfaceStyle, override: SurfaceStyle): SurfaceStyle {
  const merged: SurfaceStyle = { ...base };
  for (const key of [
    "surface",
    "ink",
    "shape",
    "radius",
    "opacity",
    "textScale",
    "icon",
  ] as const) {
    const value = override[key];
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  if (override.sides) {
    const sides: NonNullable<SurfaceStyle["sides"]> = { ...base.sides };
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const edge = override.sides[side];
      if (!edge) continue;
      const previous = sides[side];
      sides[side] = previous ? { ...previous, ...edge } : edge;
    }
    merged.sides = sides;
  }
  return merged;
}

function parseHex(colour: string): [number, number, number] | null {
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
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

/**
 * WCAG contrast between two hex colours, or null when either is not a hex value
 * the guard can read (a token may be an `rgba()` or a `color-mix()`).
 */
export function contrastRatio(background: string, ink: string): number | null {
  const backgroundRgb = parseHex(background);
  const inkRgb = parseHex(ink);
  if (!backgroundRgb || !inkRgb) return null;
  const light = relativeLuminance(backgroundRgb);
  const dark = relativeLuminance(inkRgb);
  const [high, low] = light >= dark ? [light, dark] : [dark, light];
  return (high + 0.05) / (low + 0.05);
}

/** Ink candidates in the order the floor prefers them. */
const INK_CANDIDATES: readonly StyleColourRole[] = [
  "ink",
  "ink-muted",
  "surface-strong",
  "accent",
  "canvas",
  "surface",
];

/**
 * The ink that clears the floor on this surface, or the best available when no
 * role does (a theme can be low-contrast on purpose; the guard still reports it).
 */
export function floorInk(
  surface: StyleColourRole | "none",
  ink: StyleColourRole,
  palette: SurfacePalette,
): { ink: StyleColourRole; ratio: number; corrected: boolean } | null {
  if (surface === "none") return null;
  const background = palette[surface];
  if (!background) return null;
  // The pair itself first, so an already-legible combination is left untouched.
  const currentRatio = palette[ink] ? contrastRatio(background, palette[ink]) : null;
  if (currentRatio === null) return null;
  if (currentRatio >= CONTRAST_FLOOR) {
    return { ink, ratio: currentRatio, corrected: false };
  }
  let best: { ink: StyleColourRole; ratio: number } | null = null;
  for (const candidate of INK_CANDIDATES) {
    const colour = palette[candidate];
    if (!colour) continue;
    const ratio = contrastRatio(background, colour);
    if (ratio === null) continue;
    if (!best || ratio > best.ratio) best = { ink: candidate, ratio };
    if (ratio >= CONTRAST_FLOOR) return { ink: candidate, ratio, corrected: true };
  }
  if (!best) return null;
  return { ink: best.ink, ratio: best.ratio, corrected: true };
}

/**
 * The paint a surface actually wears: its type's style, its own over that, then the
 * contrast floor. `applied` is false when neither level named this surface, so an
 * unstyled one keeps rendering exactly as the theme paints it.
 */
export function resolveSurfaceStyleFor(
  own: SurfaceStyle | undefined,
  inherited: SurfaceStyle | undefined,
  subject: SurfaceSubject,
  palette: SurfacePalette = {},
): RuleResolution {
  const combined = mergeSurfaceStyle(inherited ?? {}, own ?? {});

  const resolved = resolveSurfaceStyle(combined, subject.surface);
  const corrections: ContrastCorrection[] = [];
  const floored = floorInk(resolved.surface, resolved.ink, palette);
  const finalStyle: ResolvedSurfaceStyle = floored?.corrected
    ? { ...resolved, ink: floored.ink }
    : resolved;
  if (floored?.corrected) {
    corrections.push({
      ruleId: null,
      surface: resolved.surface,
      ink: resolved.ink,
      corrected: floored.ink,
      ratio: floored.ratio,
      floor: CONTRAST_FLOOR,
    });
  }

  return {
    style: finalStyle,
    declared: combined,
    applied: own !== undefined || inherited !== undefined,
    corrections,
  };
}

/**
 * The inline paint for one surface. Returns nothing at all when neither level names
 * it, which is what keeps an unstyled surface byte identical to the theme.
 */
export function surfacePaintFor(
  own: SurfaceStyle | undefined,
  inherited: SurfaceStyle | undefined,
  subject: SurfaceSubject,
  palette: SurfacePalette,
): { paint: Record<string, string>; corrections: ContrastCorrection[] } {
  if (!own && !inherited) return { paint: {}, corrections: [] };
  const resolved = resolveSurfaceStyleFor(own, inherited, subject, palette);
  if (!resolved.applied) return { paint: {}, corrections: [] };
  return { paint: surfacePaintVars(resolved.style), corrections: resolved.corrections };
}

/** `rgb(…)` or `rgba(…)` as `#rrggbb`, or null when it is neither or translucent. */
function rgbToHex(colour: string): string | null {
  const match =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
      colour.trim(),
    );
  if (!match) return null;
  // A translucent surface has no single colour to measure ink against.
  if (match[4] !== undefined && Number(match[4]) < 1) return null;
  return `#${match
    .slice(1, 4)
    .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * The live palette: each role's token, resolved by the browser on the shell root.
 *
 * The guard needs colours, and the tokens are a theme's values — reading them here
 * keeps one palette in the app (ADR-0046 §1) and means a theme swap moves the floor
 * with it. A theme the browser cannot measure (a `color-mix()`, a translucent
 * surface) simply contributes nothing and is never "corrected".
 */
export function readPalette(root: HTMLElement): SurfacePalette {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) return {};
  const probe = doc.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.pointerEvents = "none";
  probe.style.opacity = "0";
  root.appendChild(probe);
  const palette: SurfacePalette = {};
  try {
    const computed = view.getComputedStyle(probe);
    for (const role of styleColourRoles) {
      probe.style.color = colourRoleVar(role);
      const hex = rgbToHex(computed.color);
      if (hex) palette[role] = hex;
    }
  } finally {
    probe.remove();
  }
  return palette;
}
