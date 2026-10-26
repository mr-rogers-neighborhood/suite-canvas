import { z } from "zod";

/**
 * The paint system's vocabulary ([ADR-0051](../../../docs/decisions/0051-one-style-vocabulary-over-edges.md)).
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

export const surfaceStyleSchema = z.object({
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

/**
 * A workspace's own palette ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)
 * Q2–Q3): the value each role resolves to, per mode.
 *
 * Per *mode*, not one flat map, because a workspace has to look like itself at
 * both brightnesses — that is what keeps "the author's palette" from meaning "the
 * author's brightness", and why a visitor's light/dark choice still works inside
 * somebody else's colours. It names base tokens only: everything the shell derives
 * from them (a muted ink, a tint, a border) is still derived, and still floors.
 */
export const workspaceThemeSchema = z.object({
  light: z.partialRecord(z.enum(styleColourRoles), z.string().min(1)).default(() => ({})),
  dark: z.partialRecord(z.enum(styleColourRoles), z.string().min(1)).default(() => ({})),
});
export type WorkspaceTheme = z.infer<typeof workspaceThemeSchema>;
export type WorkspaceThemeMode = "light" | "dark";

/** The colours a theme names for one mode, as authored. */
export function themeColours(theme: WorkspaceTheme | undefined, mode: WorkspaceThemeMode) {
  return theme?.[mode] ?? {};
}

/** True when a theme names nothing in either mode, so it can be dropped. */
export function isEmptyTheme(theme: WorkspaceTheme | undefined): boolean {
  if (!theme) return true;
  return Object.keys(theme.light).length === 0 && Object.keys(theme.dark).length === 0;
}

/** True when a style changes anything at all, so callers can drop an empty record. */
export function isEmptyStyle(style: SurfaceStyle | undefined): boolean {
  if (!style) return true;
  return (
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
