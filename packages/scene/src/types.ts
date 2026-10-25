/**
 * Geometry and layout types. These are the value shapes the pure layout planner
 * and its callers share: coordinates, transforms and fractal recipes. Nothing
 * here is document truth — a plan is computed from a snapshot and committed by
 * the caller as one batch.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis-aligned rectangle in flow (board) or page coordinates. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Uniform scale plus translation; maps board coordinates into page coordinates. */
export interface Transform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** Page -> screen: `screen = page * zoom + offset`. Matches React Flow's viewport. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Fractal layout presets (see `layout.ts` for the algorithms). */
export type LayoutPattern =
  | "grid"
  | "columns"
  | "rows"
  | "radial"
  | "spiral"
  | "phyllotaxis"
  | "rings"
  | "treemap";

export type LayoutAlign = "start" | "center" | "end";

export type LayoutOrder = "reading" | "z" | "created" | "type";

export interface LayoutDepthRecipe {
  /** Portal frame / child board ratio. */
  readonly scale: number;
  readonly gap: number;
  readonly rotate: number;
  readonly pattern?: LayoutPattern | undefined;
}

export interface FractalRecipe {
  readonly pattern: LayoutPattern;
  readonly gap: number;
  readonly padding: number;
  readonly align: LayoutAlign;
  readonly order: LayoutOrder;
  /** Optional seeded jitter in flow units; 0 keeps the pattern exact. */
  readonly jitter?: number | undefined;
  readonly seed?: number | undefined;
  readonly depth: LayoutDepthRecipe;
}
