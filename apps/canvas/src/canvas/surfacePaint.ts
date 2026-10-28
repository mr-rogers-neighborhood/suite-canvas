import type {
  ResolvedSurfaceStyle,
  StyleColourRole,
  StyleEdgePaint,
  StyleShape,
  StyleSide,
} from "@suite/graph";
import { defaultEdgeFlow } from "@suite/graph";

/**
 * From a resolved style to paint.
 *
 * The style record names *roles*; this is the one place that turns a role into
 * the CSS variable the shell already paints with, so a theme is a set of values
 * rather than a set of names. Nothing here writes to the document.
 */

/**
 * The CSS variable a colour role resolves to. The token layer owns the value.
 *
 * The map is explicit because a role is a *meaning*, not a token name: the
 * canvas role reads `--canvas-bg` and the surface role `--surface`, and a rename
 * in one place must not silently resolve a style to an undefined variable.
 */
const ROLE_TOKEN: Record<StyleColourRole, string> = {
  canvas: "--canvas-bg",
  surface: "--surface",
  "surface-strong": "--surface-strong",
  ink: "--ink",
  "ink-muted": "--ink-muted",
  hairline: "--hairline",
  accent: "--accent",
  danger: "--danger",
  success: "--success",
  warning: "--warning",
};

export function colourRoleVar(role: StyleColourRole): string {
  return `var(${ROLE_TOKEN[role]})`;
}

/**
 * The silhouette a shape paints. `rect` and `pill` are border-radius; the rest
 * are polygons, because a clip path is the only way to change the outline of an
 * element without changing its box. Paint only: hit-testing stays rectangular
 * (ADR-0051 §7), which is why a diamond is still easy to grab.
 */
export function shapeClipPath(shape: StyleShape): string | undefined {
  switch (shape) {
    case "diamond":
      return "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
    case "parallelogram":
      return "polygon(12% 0%, 100% 0%, 88% 100%, 0% 100%)";
    case "hexagon":
      return "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";
    case "document":
      // A page with a turned corner, the flowchart convention.
      return "polygon(0% 0%, 100% 0%, 100% 82%, 86% 100%, 0% 100%)";
    case "database":
      return "polygon(0% 8%, 50% 0%, 100% 8%, 100% 92%, 50% 100%, 0% 92%)";
    default:
      return undefined;
  }
}

/**
 * The silhouette's vertices in 0..1 box fractions, for the shapes a clip path draws.
 *
 * The same numbers as `shapeClipPath`, restated as geometry because two other readers
 * need them: `silhouette.ts` puts a connector dot on the outline, and `shapeInset` keeps
 * text inside it. A path is a string, so the paint is written once and the geometry is
 * derived from a table that must agree with it — `surfacePaint.test.ts` holds them
 * together.
 */
const SHAPE_OUTLINE: Partial<Record<StyleShape, ReadonlyArray<readonly [number, number]>>> = {
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  parallelogram: [
    [0.12, 0],
    [1, 0],
    [0.88, 1],
    [0, 1],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
  document: [
    [0, 0],
    [1, 0],
    [1, 0.82],
    [0.86, 1],
    [0, 1],
  ],
  database: [
    [0, 0.08],
    [0.5, 0],
    [1, 0.08],
    [1, 0.92],
    [0.5, 1],
    [0, 0.92],
  ],
};

/** The polygon a shape paints, or null when it paints a rounded rectangle or nothing. */
export function shapeOutline(
  shape: StyleShape | null | undefined,
): ReadonlyArray<readonly [number, number]> | null {
  return shape ? (SHAPE_OUTLINE[shape] ?? null) : null;
}

/**
 * True for a silhouette that is *not* the card's own box.
 *
 * These are the shapes whose paint replaces the frame rather than decorating it: the
 * card's box, ring and shadow are rectangular, so they all have to stand down, the
 * outline is one edge rather than four sides, and the content has to be pulled away
 * from corners the silhouette does not have.
 */
export function isShapedSurface(shape: StyleShape | null | undefined): boolean {
  return shape !== undefined && shape !== null && shape !== "rect";
}

/**
 * How far text and chrome move in from the box edge to stay inside the silhouette,
 * as fractions of the box's width and height.
 *
 * A circle inscribes a square of 70.7%, so its inset is 14.6% on each side. The polygon
 * shapes are derived from the same question at the depth the header sits at, then
 * rounded down: a diamond is the strict one, because its narrow ends are exactly where
 * a title wants to be.
 */
const SHAPE_INSET: Record<StyleShape, { x: number; y: number }> = {
  rect: { x: 0, y: 0 },
  pill: { x: 0.05, y: 0 },
  circle: { x: 0.15, y: 0.15 },
  diamond: { x: 0.24, y: 0.14 },
  parallelogram: { x: 0.14, y: 0.03 },
  hexagon: { x: 0.11, y: 0.04 },
  document: { x: 0.06, y: 0.04 },
  database: { x: 0.07, y: 0.08 },
};

/**
 * Half the horizontal span the silhouette has at a given depth, as a 0..1 fraction of
 * the box's width.
 *
 * A silhouette's width changes with depth, and the top of a diamond is a point: a title
 * bar placed there is either tiny or hanging outside the shape. This is the number that
 * lets the bar stop where the paint stops, without a per-shape guess.
 */
function spanAtDepth(
  outline: ReadonlyArray<readonly [number, number]>,
  depth: number,
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < outline.length; index += 1) {
    const from = outline[index];
    const to = outline[(index + 1) % outline.length];
    if (!from || !to) continue;
    const low = Math.min(from[1], to[1]);
    const high = Math.max(from[1], to[1]);
    // Only edges that straddle this depth contribute a crossing, and a horizontal edge
    // contributes both its ends — which is what the `low === high` case is.
    if (depth < low - 1e-9 || depth > high + 1e-9) continue;
    const t = high === low ? 0 : (depth - from[1]) / (to[1] - from[1]);
    const x = from[0] + (to[0] - from[0]) * t;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  return min <= max ? { min, max } : null;
}

/**
 * The inset this shape asks for, in pixels for a given box.
 *
 * `titleX` is wider than `x` wherever the silhouette narrows toward the top, because a
 * header sits nearer the apex than the body does. It is derived rather than tabulated:
 * the bar stops where the paint stops (diamond, hexagon, parallelogram), and it never
 * comes in *further* than the body's inset, so a rounded shape keeps its own.
 */
export function shapeInset(
  shape: StyleShape | null | undefined,
  size: { width: number; height: number },
): { x: number; y: number; titleX: number } {
  if (!isShapedSurface(shape)) return { x: 0, y: 0, titleX: 0 };
  const fractions = SHAPE_INSET[shape as StyleShape] ?? { x: 0, y: 0 };
  const x = Math.round(size.width * fractions.x);
  const y = Math.round(size.height * fractions.y);
  const outline = shapeOutline(shape);
  if (!outline || size.height <= 0) return { x, y, titleX: x };
  // The header's own top edge: where the shape is narrowest over the bar's height.
  const span = spanAtDepth(outline, (y * 0.5) / size.height);
  if (!span) return { x, y, titleX: x };
  // Symmetric, because a header is centred: a parallelogram's lean costs the bar its
  // wider side rather than hanging it off one edge.
  const symmetric = Math.round(size.width * Math.max(span.min, 1 - span.max));
  return { x, y, titleX: Math.max(x, symmetric) };
}

/** The corner rounding a shape implies, when the style does not name one. */
export function shapeRadius(shape: StyleShape): string | undefined {
  switch (shape) {
    case "pill":
      return "999px";
    case "circle":
      return "50%";
    case "rect":
      return undefined;
    default:
      return undefined;
  }
}

/** The CSS border the paint asks for on one side, or none. */
export function sideBorder(style: ResolvedSurfaceStyle, side: StyleSide, defaultWidth = 1): string {
  const edge = style.sides[side];
  if (!edge || edge.paint === "none") return "none";
  const width = edge.width ?? defaultWidth;
  const colour = colourRoleVar(edge.colour ?? style.ink);
  const kind = edge.paint === "solid" ? "solid" : edge.paint;
  return `${width}px ${kind} ${colour}`;
}

/** The dash animation a side runs, or none. The default follows the geometry. */
export function sideAnimation(style: ResolvedSurfaceStyle, side: StyleSide): string | undefined {
  const edge = style.sides[side];
  if (!edge || edge.paint === "solid" || edge.paint === "none") return undefined;
  if (!edge.flow || edge.flow === "none") return undefined;
  const seconds = edge.speed ?? 4;
  return `${side}-dash ${seconds}s linear infinite${edge.flow === "reverse" ? " reverse" : ""}`;
}

/**
 * The inline paint for a surface. Applied only when the surface actually has a
 * style, so an unstyled card renders exactly as it did before the paint system.
 */
export function surfacePaintVars(
  style: ResolvedSurfaceStyle | undefined,
  swatch: string | null = null,
): Record<string, string> {
  if (!style) return {};
  // Keys are real custom properties: React only passes a style entry through to
  // the element when the name starts with `--`, and a name without the prefix
  // fails silently, which is how a painted card renders as nothing at all.
  const paint: Record<string, string> = {
    "--paint-surface":
      swatch ?? (style.surface === "none" ? "transparent" : colourRoleVar(style.surface)),
    "--paint-ink": colourRoleVar(style.ink),
    "--paint-opacity": String(style.opacity),
    "--paint-text-scale": String(style.textScale),
  };
  const radius = shapeRadius(style.shape);
  if (radius) paint["--paint-radius"] = radius;
  else if (style.radius !== null) paint["--paint-radius"] = `${style.radius}px`;
  const clip = shapeClipPath(style.shape);
  if (clip) paint["--paint-clip"] = clip;
  // The silhouette is published as well as painted: the card's chrome, its connector
  // dots and the rectangle it must *not* draw all have to agree with the shape, and a
  // clip path string is not something a stylesheet or a measurement can read.
  if (isShapedSurface(style.shape) && style.shape) paint["--paint-shape"] = style.shape;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const edge = style.sides[side];
    if (!edge) continue;
    paint[`--paint-border-${side}`] = sideBorder(style, side);
    const animation = sideAnimation(style, side);
    if (animation) paint[`--paint-animation-${side}`] = animation;
  }
  return paint;
}

/**
 * The stroke pattern a dashed or dotted edge draws, in user units, with the
 * length of one repeat: a dash animation has to travel exactly one pattern or it
 * visibly jumps every cycle.
 */
const DASH_PATTERN: Partial<Record<StyleEdgePaint, { pattern: string; cycle: number }>> = {
  dashed: { pattern: "7 5", cycle: 12 },
  dotted: { pattern: "1.5 4", cycle: 5.5 },
};

/**
 * The stroke a link paints with, as React style properties.
 *
 * A link has one stroke rather than four sides (ADR-0051 §1), so `sides.top` is
 * where a link's line style lives: paint, width, colour and dash flow. Absent
 * means solid, which is why an unstyled link returns only its ink and renders
 * exactly as it did before the paint system.
 */
export function linkStroke(style: ResolvedSurfaceStyle): Record<string, string | number> {
  const edge = style.sides.top;
  const stroke: Record<string, string | number> = {
    stroke: colourRoleVar(edge?.colour ?? style.ink),
  };
  if (edge?.width !== undefined) stroke.strokeWidth = edge.width;
  const dash = edge ? DASH_PATTERN[edge.paint] : undefined;
  if (dash) {
    stroke.strokeDasharray = dash.pattern;
    stroke["--link-dash-cycle"] = String(dash.cycle);
    // `flow` defaults to the link's own direction: source to target (§6).
    const flow = edge?.flow ?? defaultEdgeFlow("link");
    if (flow !== "none") {
      stroke.animation = `link-dash ${edge?.speed ?? 4}s linear infinite${
        flow === "reverse" ? " reverse" : ""
      }`;
    }
  }
  if (style.opacity !== 1) stroke.opacity = style.opacity;
  return stroke;
}
