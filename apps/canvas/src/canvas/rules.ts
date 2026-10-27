import {
  CONTRAST_FLOOR,
  contrastRatio,
  INK_CANDIDATES,
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

export { CONTRAST_FLOOR, contrastRatio };

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

/** A swatch resolved for one mode: the colour, and the ink chosen when it was saved. */
export interface SwatchPaint {
  colour: string;
  ink: StyleColourRole;
}

/**
 * The ink that clears the floor on this background, or the best available when no
 * role does. A swatch that carried its own ink never reaches the correction path:
 * the pair was chosen against this colour when the reader saved it.
 */
export function floorInk(
  surface: StyleColourRole | "none",
  ink: StyleColourRole,
  palette: SurfacePalette,
  swatch: SwatchPaint | null = null,
): { ink: StyleColourRole; ratio: number; corrected: boolean } | null {
  if (surface === "none" && swatch === null) return null;
  const background = swatch?.colour ?? (surface === "none" ? undefined : palette[surface]);
  if (!background) return null;
  // The pair itself first, so an already-legible combination is left untouched.
  const current = palette[ink] ? contrastRatio(background, palette[ink]) : null;
  if (current === null) return null;
  if (current >= CONTRAST_FLOOR) return { ink, ratio: current, corrected: false };
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
  swatch: SwatchPaint | null = null,
): RuleResolution {
  const combined = mergeSurfaceStyle(inherited ?? {}, own ?? {});
  const declared = resolveSurfaceStyle(combined, subject.surface);
  // A swatch brings its own ink. A style that names an ink still wins, because a
  // reader who overrode it meant to.
  const resolved: ResolvedSurfaceStyle =
    swatch !== null && combined.ink === undefined ? { ...declared, ink: swatch.ink } : declared;
  const corrections: ContrastCorrection[] = [];
  const floored = floorInk(resolved.surface, resolved.ink, palette, swatch);
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
  swatch: SwatchPaint | null = null,
): { paint: Record<string, string>; corrections: ContrastCorrection[] } {
  if (!own && !inherited) return { paint: {}, corrections: [] };
  const resolved = resolveSurfaceStyleFor(own, inherited, subject, palette, swatch);
  if (!resolved.applied) return { paint: {}, corrections: [] };
  return {
    paint: surfacePaintVars(resolved.style, swatch?.colour ?? null),
    corrections: resolved.corrections,
  };
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
