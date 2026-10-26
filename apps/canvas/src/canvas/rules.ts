import {
  type ResolvedSurfaceStyle,
  resolveSurfaceStyle,
  type StyleColourRole,
  type StyleRule,
  type SurfaceStyle,
  styleColourRoles,
} from "@suite/graph";
import { createContext, useContext } from "react";
import { colourRoleVar, surfacePaintVars } from "./surfacePaint";

/**
 * Named rules over roles ([ADR-0046 §3–4](../../../../docs/decisions/0046-the-shell-derives-its-colour.md)).
 *
 * A rule says *where* it applies (a scope) and *what* it assigns (a
 * `SurfaceStyle`). Rules never name surfaces and never store a value: the
 * resolver merges the rules that match a surface, then lets that surface's own
 * style win, so a per-card override stays the exception it was meant to be.
 *
 * Cards are wired to this resolver today; sections, boards, fields, links and
 * the shell regions follow from the same function, which is why the subject
 * names the region and the type rather than just a surface kind.
 */

/**
 * The readability floor ([ADR-0046 §6](../../../../docs/decisions/0046-the-shell-derives-its-colour.md)).
 * WCAG's ratio for large text and graphical objects. A rule below it is
 * corrected and reported, never applied silently. It lives here rather than in
 * `@suite/graph` because only the resolver reads it.
 */
export const CONTRAST_FLOOR = 3;

/** Shell regions a rule can target (ADR-0051 §1). */
export const shellRegions = ["app-bar", "tabs", "dock", "drawer"] as const;
export type ShellRegion = (typeof shellRegions)[number];

/** The surface a rule is resolved for. */
export interface SurfaceSubject {
  surface: "card" | "section" | "board" | "field" | "link" | "shell";
  /** A card's type, so a type rule can match it. */
  typeId?: string | undefined;
  /** The shell region, so a region rule can match it. */
  region?: ShellRegion | undefined;
}

/**
 * Role → the colour the token layer resolves it to, as `#rrggbb`. The guard
 * needs numbers, and the app reads this from the live token layer rather than
 * keeping a second palette (ADR-0046 §1).
 */
export type SurfacePalette = Partial<Record<StyleColourRole, string>>;

/** A rule that would have been unreadable, and the ink the floor chose instead. */
export interface ContrastCorrection {
  /** The rule whose assignment was corrected, or null for the surface's own style. */
  ruleId: string | null;
  surface: StyleColourRole | "none";
  ink: StyleColourRole;
  corrected: StyleColourRole;
  ratio: number;
  floor: number;
}

export interface RuleResolution {
  style: ResolvedSurfaceStyle;
  /** The style as written (rules merged, own style last), before the defaults. */
  declared: SurfaceStyle;
  /** True when the surface style or at least one rule painted this surface. */
  applied: boolean;
  /** Non-empty when the floor had to correct a pair. Show it; do not drop it. */
  corrections: ContrastCorrection[];
}

/**
 * How specific a scope is. A global rule is the floor; a kind rule narrows to one
 * surface kind; a type rule and a shell-region rule both name one concrete group
 * and so rank above it (ADR-0046 §4).
 */
const SCOPE_SPECIFICITY: Record<StyleRule["scope"]["kind"], number> = {
  global: 0,
  kind: 1,
  type: 2,
  shell: 2,
};

function scopeMatches(rule: StyleRule, subject: SurfaceSubject): boolean {
  const { scope } = rule;
  switch (scope.kind) {
    case "global":
      return true;
    case "kind":
      return scope.id === subject.surface;
    case "type":
      return subject.surface === "card" && scope.id === subject.typeId;
    case "shell":
      return subject.surface === "shell" && scope.id === subject.region;
  }
}

/** The rules that apply to a surface, least specific first, ties in rule order. */
export function matchingRules(subject: SurfaceSubject, rules: readonly StyleRule[]): StyleRule[] {
  return rules
    .filter((rule) => scopeMatches(rule, subject))
    .sort(
      (a, b) =>
        SCOPE_SPECIFICITY[a.scope.kind] - SCOPE_SPECIFICITY[b.scope.kind] ||
        a.order - b.order ||
        a.id.localeCompare(b.id),
    );
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
 * The paint a surface actually wears: the rules that match it, then its own
 * style, then the contrast floor. `applied` is false when nothing named this
 * surface, so an unpainted one keeps rendering exactly as it did before.
 */
export function resolveSurfaceStyleWithRules(
  style: SurfaceStyle | undefined,
  subject: SurfaceSubject,
  rules: readonly StyleRule[],
  palette: SurfacePalette = {},
): RuleResolution {
  const matched = matchingRules(subject, rules);
  let merged: SurfaceStyle = {};
  let ruleId: string | null = null;
  for (const rule of matched) {
    merged = mergeSurfaceStyle(merged, rule.style);
    if (rule.style.surface !== undefined || rule.style.ink !== undefined) ruleId = rule.id;
  }
  const own = style ?? {};
  const combined = mergeSurfaceStyle(merged, own);
  if (own.surface !== undefined || own.ink !== undefined) ruleId = null;

  const resolved = resolveSurfaceStyle(combined, subject.surface);
  const corrections: ContrastCorrection[] = [];
  const floored = floorInk(resolved.surface, resolved.ink, palette);
  const finalStyle: ResolvedSurfaceStyle = floored?.corrected
    ? { ...resolved, ink: floored.ink }
    : resolved;
  if (floored?.corrected) {
    corrections.push({
      ruleId,
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
    applied: style !== undefined || matched.length > 0,
    corrections,
  };
}

/**
 * The inline paint for one surface, rules included. Returns nothing at all when
 * no rule and no style name it, which is what keeps an unpainted surface byte
 * identical to the pre-rule rendering.
 */
export function surfacePaintFor(
  style: SurfaceStyle | undefined,
  subject: SurfaceSubject,
  context: SurfaceRules,
): { paint: Record<string, string>; corrections: ContrastCorrection[] } {
  if (!style && context.rules.length === 0) return { paint: {}, corrections: [] };
  const resolved = resolveSurfaceStyleWithRules(style, subject, context.rules, context.palette);
  if (!resolved.applied) return { paint: {}, corrections: [] };
  return { paint: surfacePaintVars(resolved.style), corrections: resolved.corrections };
}

/** The shell style fields the shell's CSS has a rule for. */
export const SHELL_PAINT_FIELDS = ["surface", "ink", "sides", "shape", "radius"] as const;

/**
 * The shell's paint: the workspace's shell style resolved with the named rules,
 * then written as `--shell-paint-*` on the shell root.
 *
 * The prefix is deliberate. The shell root is an ancestor of the board, and an
 * unprefixed `--paint-*` would be inherited by a card that never named that
 * edge, so a shell border would appear on every card. `fields` names only what
 * the style actually says, so a shell style that names an ink does not also
 * repaint the app bar's translucency.
 *
 * This is the shell-wide answer, which every region falls back to.
 */
export function shellPaintFor(
  style: SurfaceStyle | undefined,
  rules: readonly StyleRule[],
  palette: SurfacePalette,
): { vars: Record<string, string>; fields: string } {
  const resolved = resolveSurfaceStyleWithRules(style, { surface: "shell" }, rules, palette);
  if (!resolved.applied) return { vars: {}, fields: "" };
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(surfacePaintVars(resolved.style))) {
    vars[name.replace("--paint-", "--shell-paint-")] = value;
  }
  const fields = SHELL_PAINT_FIELDS.filter((field) => resolved.declared[field] !== undefined);
  return { vars, fields: fields.join(" ") };
}

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
 * The guard needs colours, and the tokens are a theme's values — reading them
 * here keeps one palette in the app (ADR-0046 §1) and means a theme swap moves
 * the floor with it. A theme the browser cannot measure (a `color-mix()`, a
 * translucent surface) simply contributes nothing and is never "corrected".
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

/** The rules and the live palette, provided once at the shell root. */
export interface SurfaceRules {
  rules: readonly StyleRule[];
  palette: SurfacePalette;
}

export const NO_SURFACE_RULES: SurfaceRules = { rules: [], palette: {} };

export const SurfaceRulesContext = createContext<SurfaceRules>(NO_SURFACE_RULES);

/** Cards read this; without a provider the answer is "no rules", which is today. */
export function useSurfaceRules(): SurfaceRules {
  return useContext(SurfaceRulesContext);
}

/**
 * The shell resolved **per region** ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)
 * amendment).
 *
 * A rule scoped to `shell` names a region — the app bar, the board tabs, the dock or the library — and until
 * this existed no subject ever carried a region, so the scope matched nothing and was read-only fiction in
 * the same way an unwritable `type` rule was.
 *
 * The workspace's own shell style is the base for every region: a reader who painted "the shell" meant all of
 * it. A region rule then overrides that region alone, which is why the answer has two halves — the region's
 * own paint, and whether it has one at all.
 */
export function shellRegionPaintFor(
  style: SurfaceStyle | undefined,
  rules: readonly StyleRule[],
  palette: SurfacePalette,
): Record<string, { vars: Record<string, string>; fields: string }> {
  const regions: Record<string, { vars: Record<string, string>; fields: string }> = {};
  for (const region of shellRegions) {
    const resolved = resolveSurfaceStyleWithRules(
      style,
      { surface: "shell", region },
      rules,
      palette,
    );
    if (!resolved.applied) {
      regions[region] = { vars: {}, fields: "" };
      continue;
    }
    const vars: Record<string, string> = {};
    for (const [name, value] of Object.entries(surfacePaintVars(resolved.style))) {
      vars[name.replace("--paint-", `--shell-${region}-paint-`)] = value;
    }
    const fields = SHELL_PAINT_FIELDS.filter((field) => resolved.declared[field] !== undefined);
    regions[region] = { vars, fields: fields.join(" ") };
  }
  return regions;
}
