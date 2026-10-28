import type {
  StyleColourRole,
  StyleEdgeFlow,
  StyleEdgePaint,
  StyleShape,
  StyleSide,
} from "@suite/graph";
import {
  styleColourRoles,
  styleEdgeFlows,
  styleEdgePaints,
  styleShapes,
  styleSides,
} from "@suite/graph";

/**
 * The words and the values every style control shares.
 *
 * The inspector, the type editor, the board's Appearance submenu and the bulk bar
 * all edit the same record, so they have to offer the same choices in the same
 * words. They used to keep private copies — the bulk bar said "Rectangle" where
 * the inspector said something else — and two vocabularies for one field is how a
 * reader learns to distrust both.
 *
 * Nothing here imports React, so the canvas can use it without depending on the
 * inspector and the inspector can use it without depending on the canvas.
 */

export const SHAPE_LABELS: Record<StyleShape, string> = {
  rect: "Rectangle",
  pill: "Pill",
  diamond: "Diamond",
  parallelogram: "Parallelogram",
  circle: "Circle",
  document: "Document",
  database: "Database",
  hexagon: "Hexagon",
};

export const SIDE_LABELS: Record<StyleSide, string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
};

export const FLOW_LABELS: Record<StyleEdgeFlow, string> = {
  none: "Still",
  forward: "Along the link",
  reverse: "Reversed",
};

export const PAINT_LABELS: Record<StyleEdgePaint, string> = {
  solid: "Solid",
  dashed: "Dashed",
  dotted: "Dotted",
  none: "None",
};

/** One enumerated choice, and the value that clears it. */
export interface StyleOption<T> {
  value: T | undefined;
  label: string;
}

/** A colour role as words: `muted-accent` reads "Muted Accent". */
export function roleWord(role: StyleColourRole): string {
  return role
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The clearing choice, spelled the same in every editor. */
export const DEFAULT_LABEL = "Default";

export const SHAPE_OPTIONS: readonly StyleOption<StyleShape>[] = [
  { value: undefined, label: DEFAULT_LABEL },
  ...styleShapes.map((shape) => ({ value: shape, label: SHAPE_LABELS[shape] })),
];

export const PAINT_OPTIONS: readonly StyleOption<StyleEdgePaint>[] = styleEdgePaints.map(
  (paint) => ({ value: paint, label: PAINT_LABELS[paint] }),
);

/** A line's flow, with "along the link" as the unset value rather than a fourth. */
export const FLOW_OPTIONS: readonly StyleOption<StyleEdgeFlow>[] = [
  { value: undefined, label: FLOW_LABELS.forward },
  ...styleEdgeFlows
    .filter((flow) => flow !== "forward")
    .map((flow) => ({ value: flow, label: FLOW_LABELS[flow] })),
];

/** The fill a card can be given without a palette: a role, bare, or the theme. */
export const FILL_OPTIONS: readonly StyleOption<StyleColourRole | "none">[] = [
  { value: undefined, label: DEFAULT_LABEL },
  { value: "none", label: "None (bare)" },
  ...styleColourRoles.map((role) => ({ value: role, label: roleWord(role) })),
];

export const SIDES: readonly StyleSide[] = styleSides;

/**
 * The rows a surface has, so a bulk edit can offer a selection exactly what a
 * single card is offered.
 *
 * A link is one stroke: no silhouette, no fill, one paint and one flow. A card is
 * a box, so it has a shape, a fill and edges — one `Outline` row once the shape is
 * a silhouette, because a diamond has no top edge that is not its bottom one.
 */
export type StyleRowId = "shape" | "fill" | "outline" | "linePaint" | "lineFlow";

export interface StyleRow {
  id: StyleRowId;
  label: string;
}

export function styleRowsFor(kind: "card" | "link"): readonly StyleRow[] {
  if (kind === "link") {
    return [
      { id: "linePaint", label: "Style" },
      { id: "lineFlow", label: "Flow" },
    ];
  }
  return [
    { id: "shape", label: "Shape" },
    { id: "fill", label: "Fill" },
    { id: "outline", label: "Outline" },
  ];
}
