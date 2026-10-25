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
export function surfacePaintVars(style: ResolvedSurfaceStyle | undefined): Record<string, string> {
  if (!style) return {};
  // Keys are real custom properties: React only passes a style entry through to
  // the element when the name starts with `--`, and a name without the prefix
  // fails silently, which is how a painted card renders as nothing at all.
  const paint: Record<string, string> = {
    "--paint-surface": style.surface === "none" ? "transparent" : colourRoleVar(style.surface),
    "--paint-ink": colourRoleVar(style.ink),
    "--paint-opacity": String(style.opacity),
    "--paint-text-scale": String(style.textScale),
  };
  const radius = shapeRadius(style.shape);
  if (radius) paint["--paint-radius"] = radius;
  else if (style.radius !== null) paint["--paint-radius"] = `${style.radius}px`;
  const clip = shapeClipPath(style.shape);
  if (clip) paint["--paint-clip"] = clip;
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
